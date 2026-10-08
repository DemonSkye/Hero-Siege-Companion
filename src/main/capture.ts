import { findNpcapDevice, listNpcapDevices, openPacketCapture, type PacketCaptureHandle } from "./capture-adapter";
import { appendJsonLog, sanitizeDebugSnippet } from "./capture-debug";
import {
  eventDebugSummary,
  isOnlyItemEvents,
  messageHasRoute,
  messageKeySummary,
  shouldDebugPayload,
  shouldLogEvent,
  summarizeEvent,
} from "./capture-events";
import { GeneratedDropCorrelator, RecentEventDeduplicator } from "./capture-event-state";
import {
  captureConnectionFlowKey,
  capturePacketFlowKey,
  connectionSignature,
  getHeroSiegeNetworkState,
  getNpcapRegistry,
  getNpcapServiceStatus,
  refreshRetainedCaptureTargets,
  selectGameServerConnections,
  stableCaptureFilter,
  summarizeConnections,
  uniqueCaptureTargets,
  type CapturePacketEndpoints,
  type CaptureTarget,
  type HeroSiegeNetworkState,
  type RetainedCaptureTarget,
} from "./capture-network";
import { getTcpPacketEndpoints, getTcpSegment, isLikelyParseablePayload, PacketBuffers, type ParsedPayload, type CapturedTcpLifecycle } from "./packet-decoder";
import type { CaptureConnection, CaptureHealth, CapturePreferences, PlayerChatLogContext } from "../shared/app-state";
import { EVENT_NAMES } from "../shared/constants";
import type { MessageValue } from "../shared/fields";
import type { CapturedSessionPayload } from "./captured-session-context";
import { DEFAULT_CAPTURE_PREFERENCES } from "../shared/initial-state";
import { captureMessages, extractPlayerChatMessages, messageToEvents, type ParsedEvent } from "../shared/parser";

const MAX_LOG_SNIPPET = 180;
const MAX_DEBUG_LOG_BYTES = 10 * 1024 * 1024;
const MAX_WIDE_DEBUG_LOG_BYTES = 100 * 1024 * 1024;
const POLL_INTERVAL_MS = 1000;
const CAPTURE_DIAGNOSTIC_HEARTBEAT_MS = 15_000;
const MAX_PARSE_PAYLOAD_CHARS = 1_000_000;
const PARSER_FAILURE_RESTART_THRESHOLD = 3;
const PARSER_RECOVERY_DELAY_MS = 750;
const PARSER_ERROR_LOG_INTERVAL_MS = 5000;
const ITEM_DEBUG_PAYLOAD_INTERVAL_MS = 10_000;
// Live backend responses have been observed just beyond ten seconds. Keep the
// passive lifecycle open long enough for those valid replies to resolve.
const SATANIC_ZONE_RESPONSE_TIMEOUT_MS = 15_000;
const MAX_PENDING_SATANIC_ZONE_REQUESTS = 100;
const CAPTURE_FLOW_GRACE_MS = 3_000;
const SUPPORTED_LINK_TYPES = new Set(["ETHERNET", "RAW", "NULL", "LINKTYPE_LINUX_SLL"]);
const SATANIC_ZONE_REQUEST_ROUTE = "satanic_zone_get";

export interface CaptureUpdate {
  /** Main-only signal: the native observer stopped or lost relevant packet evidence. */
  observationGap?: true;
  /** This gameplay handle changed; the separate SZ API listener may remain continuous. */
  observationGapSource?: "gameplay-reconfigure";
  /** Main-only attribution; unrelated continuous flows can retain their context. */
  observationGapFlow?: Pick<ParsedPayload, "src" | "dst" | "srcPort" | "dstPort">;
  /** Main-only reassembly evidence boundary; never an account/session value. */
  observationBoundary?: number;
  connections?: CaptureConnection[];
  health?: Partial<CaptureHealth>;
  events?: ParsedEvent[];
  log?: CaptureLog;
  logs?: CaptureLog[];
  running?: boolean;
  status?: "idle" | "waiting" | "running" | "error";
  error?: string | null;
  satanicZoneActivity?: SatanicZoneCaptureActivity;
}

export interface CaptureLog {
  level: "info" | "success" | "warning" | "error" | "debug";
  message: string;
  playerChat?: PlayerChatLogContext;
}

export type SatanicZoneCaptureActivity =
  | { kind: "request"; observedAt: number }
  | { kind: "timeout"; observedAt: number; requestedAt: number };

interface EndpointIdentity {
  direction: "inbound" | "outbound";
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
}

interface EndpointTrafficStats {
  remoteAddress: string;
  remotePort: number;
  inboundPackets: number;
  outboundPackets: number;
  inboundPayloads: number;
  outboundPayloads: number;
  lastInboundAt: number;
  lastOutboundAt: number;
}

interface PendingSatanicZoneRequest {
  id: number;
  requestIndex: number;
  requestCount: number;
  requestedAt: number;
  endpoint: EndpointIdentity;
  snippet: string;
  timeout: NodeJS.Timeout;
}

export class CaptureService {
  private cap: PacketCaptureHandle | null = null;
  private buffer = Buffer.alloc(65535);
  private activeLinkType = "";
  private pollTimer: NodeJS.Timeout | null = null;
  private diagnosticHeartbeatTimer: NodeJS.Timeout | null = null;
  private activeSignature = "";
  private activeLocalAddress = "";
  private activeFilter = "";
  private captureGenerationSequence = 0;
  private activeCaptureGeneration: number | null = null;
  private activeCaptureTargetCount = 0;
  private activeCaptureConnectionCount = 0;
  private captureOpenAttempts = 0;
  private captureOpenCount = 0;
  private captureReopenCount = 0;
  private captureCloseAttempts = 0;
  private captureCloseCount = 0;
  private captureCloseFailures = 0;
  private refreshInFlight = false;
  private lastCaptureOpenAt = 0;
  private lastCaptureCloseAt = 0;
  private lastCaptureCloseReason = "";
  private lastRefreshAt = 0;
  private lastPacketAt = 0;
  private lastPayloadAt = 0;
  private lastEventAt = 0;
  private readonly packetBuffers = new PacketBuffers((packet, boundary) => {
    const { src, dst, srcPort, dstPort } = packet;
    this.emit({ observationGap: true, observationGapFlow: { src, dst, srcPort, dstPort },
      observationBoundary: boundary });
  });
  private packetsSeen = 0;
  private payloadsAssembled = 0;
  private messagesDecoded = 0;
  private parsedEvents = 0;
  private parserErrors = 0;
  private parserRestarts = 0;
  private consecutiveParserFailures = 0;
  private lastParserErrorLogAt = 0;
  private parserRecoveryTimer: NodeJS.Timeout | null = null;
  private lastGoldProbeAt = 0;
  private lastAntiCheatWaitLogAt = 0;
  private lastItemDebugPayloadAt = 0;
  private widePacketSequence = 0;
  private widePayloadSequence = 0;
  private captureRequested = false;
  private satanicZoneRequestSequence = 0;
  private readonly endpointTrafficStats = new Map<string, EndpointTrafficStats>();
  private readonly captureFlowExpirations = new Map<string, number>();
  private observedProcessSignature = "";
  private readonly retainedCaptureTargets = new Map<string, RetainedCaptureTarget>();
  private readonly pendingSatanicZoneRequests = new Map<number, PendingSatanicZoneRequest>();
  private readonly eventDeduplicator = new RecentEventDeduplicator();
  private readonly generatedDropCorrelator = new GeneratedDropCorrelator();

  constructor(
    private readonly emit: (update: CaptureUpdate) => void,
    private readonly debugLogPath?: string,
    private readonly wideDebugLogPath?: string,
    capturePreferences: CapturePreferences | boolean = DEFAULT_CAPTURE_PREFERENCES,
    private readonly observeSessionPayload: (payload: CapturedSessionPayload) => void = () => undefined,
    private readonly observeGameProcessIds: (processIds: readonly number[], reason?: "capture-stopped") => void = () => undefined,
    private readonly observeTcpLifecycle: (packet: CapturedTcpLifecycle) => void = () => undefined,
  ) {
    this.capturePreferences = captureLoggingPreferences(capturePreferences);
  }

  private capturePreferences: CapturePreferences;
  private readonly packetLoggingPreferences: CapturePreferences[] = [];

  private get loggingPreferences(): CapturePreferences {
    return this.packetLoggingPreferences.at(-1) ?? this.capturePreferences;
  }

  setCapturePreferences(preferences: CapturePreferences): void {
    const nextPreferences = captureLoggingPreferences(preferences);
    if (capturePreferencesEqual(this.capturePreferences, nextPreferences)) return;
    this.capturePreferences = nextPreferences;
    // A callback may suppress logging now, but cannot widen any active packet's cap.
    for (const packetPreferences of this.packetLoggingPreferences) {
      for (const key of ["captureDebugLogging", "capturePayloadLogging", "captureWideLogging", "satanicZoneDebugLogging"] as const) {
        packetPreferences[key] &&= nextPreferences[key];
      }
    }
    this.writeDebugLog("capture-logging-preferences", {
      preferences: nextPreferences,
      debugLogPath: this.debugLogPath ?? null,
      wideDebugLogPath: this.wideDebugLogPath ?? null,
    });
    this.writeWideDebugLog("capture-logging-preferences", {
      preferences: nextPreferences,
      activeSignature: this.activeSignature || null,
      activeLinkType: this.activeLinkType || null,
      activeFilter: this.activeFilter || null,
    });
  }

  async diagnostics(): Promise<Partial<CaptureHealth>> {
    const [registryResult, serviceResult] = await Promise.allSettled([getNpcapRegistry(), getNpcapServiceStatus()]);
    const registry = registryResult.status === "fulfilled" ? registryResult.value : { adminOnly: false, winPcapCompatible: false };
    if (registryResult.status === "rejected" || serviceResult.status === "rejected") {
      this.writeDebugLog("capture-diagnostics-error", {
        registryError: registryResult.status === "rejected" ? errorMessage(registryResult.reason) : null,
        serviceError: serviceResult.status === "rejected" ? errorMessage(serviceResult.reason) : null,
      });
    }
    return {
      npcapService: serviceResult.status === "fulfilled" ? serviceResult.value : "Unknown",
      winPcapCompatible: registry.winPcapCompatible,
      adminOnly: registry.adminOnly,
    };
  }

  async hasHeroSiegeProcess(): Promise<boolean> {
    const networkState = await getHeroSiegeNetworkState();
    this.observeGameProcessIdsSafely(networkState.gameProcessIds);
    return networkState.gameProcessIds.length > 0;
  }

  async start(): Promise<void> {
    if (this.captureRequested || this.pollTimer) return;
    this.captureRequested = true;

    let initialNetworkState: HeroSiegeNetworkState;
    try {
      initialNetworkState = await getHeroSiegeNetworkState();
      this.observeGameProcessIdsSafely(initialNetworkState.gameProcessIds);
    } catch (error) {
      if (!this.captureRequested) return;
      this.captureRequested = false;
      const message = errorMessage(error);
      this.writeDebugLog("capture-start-error", { error: message });
      this.emit({
        running: false,
        status: "error",
        error: message,
        connections: [],
        log: { level: "error", message: `Capture could not inspect Hero Siege connections: ${message}` },
      });
      return;
    }
    if (!this.captureRequested) return;
    if (initialNetworkState.gameProcessIds.length === 0) {
      this.captureRequested = false;
      this.emit({
        running: false,
        status: "idle",
        error: null,
        connections: [],
        health: await this.diagnostics(),
        log: { level: "info", message: "Hero Siege is not running. Start the game, wait for it to finish launching, then click Launch Game." },
      });
      return;
    }

    if (
      initialNetworkState.antiCheatProcessIds.length > 0
      && gameOwnedConnections(initialNetworkState).length === 0
    ) {
      this.captureRequested = false;
      this.emit({
        running: false,
        status: "idle",
        error: null,
        connections: [],
        health: await this.diagnostics(),
        log: { level: "warning", message: "Easy Anti-Cheat is still launching Hero Siege. Wait for the game to reach the menu, then click Launch Game." },
      });
      return;
    }

    this.emit({ running: true, status: "waiting", error: null, health: await this.diagnostics() });
    this.writeDebugLog("capture-start", {
      debugLogPath: this.debugLogPath,
      wideDebugLogPath: this.wideDebugLogPath,
      preferences: this.capturePreferences,
      lifecycle: this.captureLifecycleSnapshot(),
    });
    await this.refreshCapture(initialNetworkState);
    if (!this.captureRequested) return;
    this.startDiagnosticHeartbeat();
    this.pollTimer = setInterval(() => void this.refreshCaptureSafely("poll"), POLL_INTERVAL_MS);
  }

  stop(): void {
    this.captureRequested = false;
    this.stopTimers();
    this.resetCaptureSession();
    this.observeGameProcessIdsSafely([], "capture-stopped");
    this.emit({ running: false, status: "idle", health: { device: null, filter: "" }, log: { level: "info", message: "Capture stopped." } });
  }

  private stopTimers(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.parserRecoveryTimer) clearTimeout(this.parserRecoveryTimer);
    if (this.diagnosticHeartbeatTimer) clearInterval(this.diagnosticHeartbeatTimer);
    this.pollTimer = null;
    this.parserRecoveryTimer = null;
    this.diagnosticHeartbeatTimer = null;
  }

  private resetCaptureSession(reason = "close"): void {
    this.closeCapture(reason);
    this.activeSignature = "";
    this.activeLocalAddress = "";
    this.activeLinkType = "";
    this.activeFilter = "";
    this.captureFlowExpirations.clear();
    this.retainedCaptureTargets.clear();
    this.resetPacketState();
  }

  private resetPacketState(): void {
    this.packetBuffers.discardObservation();
    this.eventDeduplicator.clear();
    this.generatedDropCorrelator.clear();
    this.endpointTrafficStats.clear();
    this.clearPendingSatanicZoneRequests();
  }

  private async refreshCaptureSafely(source: string): Promise<void> {
    if (this.refreshInFlight) return;
    this.refreshInFlight = true;
    try {
      await this.refreshCapture();
    } catch (error) {
      if (!this.captureRequested) return;
      this.writeDebugLog("capture-refresh-error", {
        source,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
        capOpen: Boolean(this.cap),
        activeSignature: this.activeSignature,
        activeGeneration: this.activeCaptureGeneration,
        lifecycle: this.captureLifecycleSnapshot(),
      });
      this.emit({
        status: this.cap ? "running" : "waiting",
        health: {
          packetsSeen: this.packetsSeen,
          payloadsAssembled: this.payloadsAssembled,
          messagesDecoded: this.messagesDecoded,
          parsedEvents: this.parsedEvents,
        },
        log: { level: "warning", message: `Capture refresh failed but capture is still alive: ${error instanceof Error ? error.message : String(error)}` },
      });
    } finally {
      this.refreshInFlight = false;
    }
  }

  private async refreshCapture(networkState?: HeroSiegeNetworkState): Promise<void> {
    if (!this.captureRequested) return;
    this.lastRefreshAt = Date.now();
    const currentNetworkState = networkState
      ?? (await getHeroSiegeNetworkState());
    this.observeGameProcessIdsSafely(currentNetworkState.gameProcessIds);
    if (!this.captureRequested) return;
    const connections = currentNetworkState.connections;
    const publicConnections = gameOwnedConnections(currentNetworkState);
    this.emit({ connections: publicConnections, observationBoundary: this.packetBuffers.observationBoundary() });

    if (currentNetworkState.gameProcessIds.length === 0) {
      this.captureRequested = false;
      this.stopTimers();
      this.resetCaptureSession("game-exited");
      this.writeDebugLog("capture-game-exited", {});
      this.emit({
        running: false,
        status: "idle",
        error: null,
        connections: [],
        health: { device: null, filter: "" },
        log: { level: "info", message: "Hero Siege closed; capture stopped." },
      });
      return;
    }

    if (
      currentNetworkState.antiCheatProcessIds.length > 0
      && publicConnections.length === 0
    ) {
      this.resetCaptureSession("anti-cheat-waiting");
      const update: CaptureUpdate = {
        status: "waiting",
        health: { device: null, filter: "" },
      };
      const now = Date.now();
      if (now - this.lastAntiCheatWaitLogAt > 30_000) {
        this.lastAntiCheatWaitLogAt = now;
        update.log = { level: "warning", message: "Easy Anti-Cheat is launching Hero Siege; capture is waiting." };
      }
      this.emit(update);
      return;
    }

    const captureConnections = selectGameServerConnections(connections);
    const signature = connectionSignature(captureConnections);
    if (!signature) {
      if (this.activeSignature !== "") this.emit({ log: { level: "warning", message: "Hero Siege game-server connections disappeared." } });
      this.resetCaptureSession("no-game-server-connections");
      this.writeDebugLog("capture-waiting-for-game-connections", { connections: summarizeConnections(connections) });
      this.emit({ status: "waiting", health: { device: null, filter: "" } });
      return;
    }

    const localAddress = unique(captureConnections.map((connection) => connection.localAddress))[0] ?? "";
    if (this.activeLocalAddress && localAddress !== this.activeLocalAddress) this.retainedCaptureTargets.clear();
    const targets: CaptureTarget[] = refreshRetainedCaptureTargets(
      this.retainedCaptureTargets,
      captureConnections,
      this.lastRefreshAt,
      CAPTURE_FLOW_GRACE_MS,
    );
    const filter = stableCaptureFilter(localAddress, targets);
    this.refreshCaptureFlows(captureConnections);
    if (signature === this.activeSignature && filter === this.activeFilter && this.cap) {
      this.activeCaptureConnectionCount = captureConnections.length;
      this.activeCaptureTargetCount = targets.length;
      return;
    }

    if (this.cap && localAddress === this.activeLocalAddress && filter === this.activeFilter) {
      const previousSignature = this.activeSignature;
      this.activeSignature = signature;
      this.activeCaptureConnectionCount = captureConnections.length;
      this.activeCaptureTargetCount = targets.length;
      this.writeDebugLog("capture-connections-updated", {
        previousSignature,
        activeSignature: signature,
        activeFilter: filter,
        filterKept: true,
        activeGeneration: this.activeCaptureGeneration,
        targetCount: targets.length,
        connectionCount: captureConnections.length,
        connections: summarizeConnections(connections),
      });
      return;
    }

    this.openCapture(signature, captureConnections, connections, filter);
  }

  private observeGameProcessIdsSafely(processIds: readonly number[], reason?: "capture-stopped"): void {
    if (reason !== "capture-stopped") {
      const signature = [...new Set(processIds.filter(id => Number.isSafeInteger(id) && id > 0))]
        .sort((left, right) => left - right).join(",");
      if (signature !== this.observedProcessSignature) {
        this.observedProcessSignature = signature;
        this.packetBuffers.clear(); // A proved process generation change permits new TCP sequence spaces.
      }
    }
    try {
      if (reason) this.observeGameProcessIds(processIds, reason);
      else this.observeGameProcessIds(processIds);
    } catch {
      // Session context observation must never interrupt capture discovery.
    }
  }

  private openCapture(
    signature: string,
    connections: CaptureConnection[],
    allConnections = connections,
    requestedFilter?: string,
  ): void {
    const localAddresses = unique(connections.map((connection) => connection.localAddress));
    const localAddress = localAddresses[0];
    const targets = uniqueCaptureTargets(connections);

    if (!localAddress || targets.length === 0) {
      this.writeDebugLog("capture-waiting-for-connections", { connections: summarizeConnections(allConnections) });
      this.emit({ status: "waiting", log: { level: "warning", message: "Waiting for usable Hero Siege game-server connections." } });
      return;
    }

    const device = findNpcapDevice(localAddress);
    if (!device) {
      const devices = listNpcapDevices();
      this.resetCaptureSession("adapter-missing");
      this.writeDebugLog("capture-adapter-missing", {
        localAddress,
        targets,
        devices: devices || "none",
        connections: summarizeConnections(allConnections),
      });
      this.emit({
        status: "error",
        error: `Npcap cannot find the adapter for ${localAddress}.`,
        log: { level: "error", message: `Npcap adapter lookup failed for ${localAddress}. Devices: ${devices || "none"}` },
      });
      return;
    }

    const filter = requestedFilter ?? stableCaptureFilter(localAddress, targets);
    const generation = ++this.captureGenerationSequence;
    const previousGeneration = this.activeCaptureGeneration;
    const openReason = previousGeneration !== null ? "reopen" : this.captureOpenCount > 0 ? "recovery" : "initial";
    const openStartedAt = Date.now();
    this.captureOpenAttempts += 1;
    this.writeDebugLog("capture-open-start", {
      generation,
      previousGeneration,
      reason: openReason,
      targetCount: targets.length,
      connectionCount: connections.length,
      observedConnectionCount: allConnections.length,
      counters: this.captureCounterSnapshot(),
      lifecycle: this.captureLifecycleSnapshot(),
    });

    try {
      this.closeCapture("reopen");
      const openedCapture = openPacketCapture(device, filter, this.buffer, (nbytes, truncated) => {
        if (this.captureRequested && this.activeCaptureGeneration === generation) this.onPacket(nbytes, truncated);
      });
      const linkType = openedCapture.linkType;
      this.cap = openedCapture.cap;
      this.activeCaptureGeneration = generation;
      this.activeSignature = signature;
      this.activeLocalAddress = localAddress;
      this.activeLinkType = linkType;
      this.activeFilter = filter;
      this.activeCaptureTargetCount = targets.length;
      this.activeCaptureConnectionCount = connections.length;
      this.lastCaptureOpenAt = Date.now();
      this.captureOpenCount += 1;
      if (openReason !== "initial") this.captureReopenCount += 1;
      this.resetPacketState();
      this.refreshCaptureFlows(connections);
      this.writeDebugLog("capture-open", {
        phase: "returned",
        generation,
        previousGeneration,
        reason: openReason,
        durationMs: Math.max(0, this.lastCaptureOpenAt - openStartedAt),
        targetCount: targets.length,
        connectionCount: connections.length,
        observedConnectionCount: allConnections.length,
        counters: this.captureCounterSnapshot(),
        lifecycle: this.captureLifecycleSnapshot(),
        device,
        filter,
        linkType,
        targets,
        connections: summarizeConnections(allConnections),
      });
      this.emit({
        running: true,
        status: "running",
        health: { device, filter },
        logs: [
          { level: "success", message: `Capture opened on ${device} (${linkType}).` },
          ...(SUPPORTED_LINK_TYPES.has(linkType)
            ? []
            : [{ level: "warning" as const, message: `Npcap opened an unsupported adapter link type (${linkType}); packets may not decode.` }]),
        ],
      });
    } catch (error) {
      this.resetCaptureSession("open-error");
      const message = errorMessage(error);
      this.writeDebugLog("capture-open-error", {
        generation,
        previousGeneration,
        reason: openReason,
        durationMs: Math.max(0, Date.now() - openStartedAt),
        error: sanitizeDebugSnippet(message, MAX_LOG_SNIPPET),
        targetCount: targets.length,
        connectionCount: connections.length,
        observedConnectionCount: allConnections.length,
        counters: this.captureCounterSnapshot(),
        lifecycle: this.captureLifecycleSnapshot(),
        filter,
        targets,
        connections: summarizeConnections(allConnections),
      });
      this.emit({
        status: "error",
        error: message,
        log: { level: "error", message: `Capture failed: ${message}` },
      });
    }
  }

  private onPacket(nbytes: number, truncated: boolean): void {
    this.withPacketLogging(() => {
      try {
        this.processPacket(nbytes, truncated);
      } catch (error) {
        this.recordParserFailure("packet", error, "");
      }
    });
  }

  private processPacket(nbytes: number, truncated: boolean): void {
    this.withPacketLogging(() => this.processCapturedPacket(nbytes, truncated));
  }

  private withPacketLogging(process: () => void): void {
    this.packetLoggingPreferences.push(captureLoggingPreferences(this.loggingPreferences));
    try { process(); }
    finally { this.packetLoggingPreferences.pop(); }
  }

  private processCapturedPacket(nbytes: number, truncated: boolean): void {
    const parsedPacket = getTcpSegment(this.buffer, nbytes, this.activeLinkType);
    const endpoints = parsedPacket ?? getTcpPacketEndpoints(this.buffer, nbytes, this.activeLinkType);
    if (!endpoints || !this.isCaptureFlowPacket(endpoints)) return;
    if (!parsedPacket || truncated) {
      this.packetBuffers.discardObservation(endpoints);
      const { src, dst, srcPort, dstPort } = endpoints;
      this.emit({ observationGap: true, observationGapFlow: { src, dst, srcPort, dstPort },
        observationBoundary: this.packetBuffers.observationBoundary() });
    }
    if (!parsedPacket) return;
    // A reused tuple's SYN belongs to the new stream, before any context payload.
    if (!truncated && (parsedPacket.flags & 2) !== 0) {
      this.packetBuffers.discardFlow(parsedPacket);
      this.observeTcpLifecycleSafely(parsedPacket);
    }
    if (parsedPacket.payloadLength === 0) {
      if (!truncated && (parsedPacket.flags & 2) === 0) this.observeTcpLifecycleSafely(parsedPacket);
      return;
    }

    this.lastPacketAt = Date.now();
    this.packetsSeen += 1;
    this.recordEndpointTraffic(parsedPacket, "packet");
    this.writeWidePacketLog(parsedPacket, nbytes, truncated);
    if (truncated) {
      this.emit({
        health: { packetsSeen: this.packetsSeen },
        log: { level: "warning", message: "Npcap truncated a game packet; its incomplete payload was discarded." },
      });
      return;
    }
    const completedPayloads = this.packetBuffers.push(parsedPacket);
    const events: ParsedEvent[] = [];
    const observedLogs: CaptureLog[] = [];

    for (const completedPayload of completedPayloads) {
      const { packet, text: payloadText } = completedPayload;
      this.recordEndpointTraffic(packet, "payload");
      this.writeWidePayloadLog(packet, payloadText);
      if (!completedPayload.sessionAlreadyObserved) this.observeSessionPayloadSafely(packet, payloadText);
      if (completedPayload.observationOnly) continue;
      if (!isLikelyParseablePayload(payloadText)) continue;
      if (payloadText.length > MAX_PARSE_PAYLOAD_CHARS) {
        this.recordParserFailure("payload-size", new Error(`Payload exceeded ${MAX_PARSE_PAYLOAD_CHARS} characters.`), payloadText);
        continue;
      }

      this.payloadsAssembled += 1;
      this.lastPayloadAt = Date.now();
      const messages = this.captureMessagesSafely(payloadText);
      if (!messages) continue;
      const playerChatMessages = extractPlayerChatMessages(messages);
      observedLogs.push(
        ...playerChatMessages.map((chat): CaptureLog => ({
          level: "info",
          message: `Player chat · ${chat.playerName}: ${chat.message}`,
          playerChat: {
            playerName: chat.playerName,
            message: chat.message,
            actionable: chat.actionable,
          },
        })),
      );
      this.generatedDropCorrelator.markTrustedResponses(packet, messages, this.activeLocalAddress, (type, data) =>
        this.writeDebugLog(type, data),
      );
      this.messagesDecoded += messages.length;
      const nextEvents = this.messageToEventsSafely(messages, payloadText);
      if (!nextEvents) continue;
      this.runParserProbeSafely("satanic-zone-payload", () => this.probeSatanicZonePayload(packet, payloadText, messages, nextEvents), payloadText);
      const usefulEvents = this.filterEventsSafely(nextEvents, payloadText);
      if (!usefulEvents) continue;
      events.push(...usefulEvents);
      this.consecutiveParserFailures = 0;
      this.runParserProbeSafely("debug-payload", () => this.probeDebugPayload(payloadText, messages, usefulEvents), payloadText);
      if (playerChatMessages.length === 0) {
        this.runParserProbeSafely("gold-payload", () => this.probeGoldPayload(payloadText, usefulEvents), payloadText);
      }
    }

    if (events.length === 0) {
      this.emit({
        health: {
          packetsSeen: this.packetsSeen,
          payloadsAssembled: this.payloadsAssembled,
          messagesDecoded: this.messagesDecoded,
        },
        log: observedLogs.length === 1 ? observedLogs[0] : undefined,
        logs: observedLogs.length > 1 ? observedLogs : undefined,
      });
      if ((parsedPacket.flags & 2) === 0) this.observeTcpLifecycleSafely(parsedPacket);
      return;
    }

    this.parsedEvents += events.length;
    this.lastEventAt = Date.now();
    const loggableEvents = events.filter((event) => shouldLogEvent(event));
    this.writeParsedEventDebugLog(loggableEvents, events.length);
    const eventLogs = loggableEvents.map((event) => ({ level: "debug" as const, message: summarizeEvent(event) }));
    const logs = [...observedLogs, ...eventLogs];
    this.emit({
      events,
      health: {
        packetsSeen: this.packetsSeen,
        payloadsAssembled: this.payloadsAssembled,
        messagesDecoded: this.messagesDecoded,
        parsedEvents: this.parsedEvents,
        parserErrors: this.parserErrors,
        parserRestarts: this.parserRestarts,
        lastParserError: null,
      },
      log: logs.length === 1 ? logs[0] : undefined,
      logs: logs.length > 1 ? logs : undefined,
    });
    if ((parsedPacket.flags & 2) === 0) this.observeTcpLifecycleSafely(parsedPacket);
  }

  private observeTcpLifecycleSafely(packet: ParsedPayload): void {
    if ((packet.flags & 7) === 0) return;
    if ((packet.flags & 5) !== 0) this.packetBuffers.discardFlow(packet);
    // Packet-entry logging preferences stay frozen if invalidation restores the
    // user's raw logging preference synchronously.
    const { src, dst, srcPort, dstPort, flags } = packet;
    try { this.observeTcpLifecycle({ src, dst, srcPort, dstPort, flags,
      observationBoundary: this.packetBuffers.observationBoundary() }); }
    catch { /* Lifecycle observation must not interrupt normal capture. */ }
  }

  private observeSessionPayloadSafely(packet: ParsedPayload, text: string): void {
    try {
      const outbound = packet.src === this.activeLocalAddress;
      this.observeSessionPayload({
        text,
        direction: outbound ? "outbound" : "inbound",
        remoteAddress: outbound ? packet.dst : packet.src,
        remotePort: outbound ? packet.dstPort : packet.srcPort,
        localAddress: outbound ? packet.src : packet.dst,
        localPort: outbound ? packet.srcPort : packet.dstPort,
        observedAt: Date.now(),
        observationSequence: packet.observationSequence,
      });
    } catch {
      // Session context observation must never interrupt ordinary capture.
    }
  }

  private writeParsedEventDebugLog(events: ParsedEvent[], totalEvents: number): void {
    const itemEvents = events.filter((event) => event.name === EVENT_NAMES.item || event.name === EVENT_NAMES.itemDrop);
    if (itemEvents.length === 0) return;
    this.writeDebugLog("parsed-events", {
      count: itemEvents.length,
      totalEvents,
      eventNames: itemEvents.map((event) => event.name),
      payloadsAssembled: this.payloadsAssembled,
      messagesDecoded: this.messagesDecoded,
      parsedEvents: this.parsedEvents,
      events: itemEvents.map((event) => eventDebugSummary(event)),
    });
  }

  private captureMessagesSafely(payloadText: string): MessageValue[] | null {
    try {
      return captureMessages(payloadText);
    } catch (error) {
      this.recordParserFailure("captureMessages", error, payloadText);
      return null;
    }
  }

  private messageToEventsSafely(messages: MessageValue[], payloadText: string): ParsedEvent[] | null {
    try {
      return messageToEvents(messages);
    } catch (error) {
      this.recordParserFailure("messageToEvents", error, payloadText);
      return null;
    }
  }

  private filterEventsSafely(events: ParsedEvent[], payloadText: string): ParsedEvent[] | null {
    try {
      return events.filter((event) => !this.eventDeduplicator.isDuplicate(event));
    } catch (error) {
      this.recordParserFailure("eventFilter", error, payloadText);
      return null;
    }
  }

  private runParserProbeSafely(stage: string, probe: () => void, payloadText: string): void {
    try {
      probe();
    } catch (error) {
      this.recordParserFailure(stage, error, payloadText);
    }
  }

  private recordParserFailure(stage: string, error: unknown, payloadText: string): void {
    this.parserErrors += 1;
    this.consecutiveParserFailures += 1;
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const snippet = payloadText ? sanitizeDebugSnippet(payloadText) : "";

    this.writeDebugLog("parser-error", {
      stage,
      error: message,
      stack,
      consecutiveParserFailures: this.consecutiveParserFailures,
      parserErrors: this.parserErrors,
      parserRestarts: this.parserRestarts,
      snippet,
    });

    const now = Date.now();
    const update: CaptureUpdate = {
      status: "running",
      health: {
        packetsSeen: this.packetsSeen,
        payloadsAssembled: this.payloadsAssembled,
        messagesDecoded: this.messagesDecoded,
        parsedEvents: this.parsedEvents,
        parserErrors: this.parserErrors,
        parserRestarts: this.parserRestarts,
        lastParserError: `${stage}: ${message}`,
      },
    };
    if (now - this.lastParserErrorLogAt >= PARSER_ERROR_LOG_INTERVAL_MS) {
      this.lastParserErrorLogAt = now;
      update.log = { level: "error", message: `Parser error isolated at ${stage}; capture is still running. ${message}` };
    }
    this.emit(update);

    if (this.consecutiveParserFailures >= PARSER_FAILURE_RESTART_THRESHOLD) {
      this.recoverParser(`${stage}: ${message}`);
    }
  }

  private recoverParser(reason: string): void {
    if (this.parserRecoveryTimer) return;

    this.parserRestarts += 1;
    this.consecutiveParserFailures = 0;
    this.resetCaptureSession("parser-recovery");
    this.writeDebugLog("parser-recovery", { reason, parserRestarts: this.parserRestarts });
    this.emit({
      status: "waiting",
      health: {
        device: null,
        filter: "",
        packetsSeen: this.packetsSeen,
        payloadsAssembled: this.payloadsAssembled,
        messagesDecoded: this.messagesDecoded,
        parsedEvents: this.parsedEvents,
        parserErrors: this.parserErrors,
        parserRestarts: this.parserRestarts,
        lastParserError: reason,
      },
      log: { level: "warning", message: "Parser failed repeatedly; capture buffers were reset and capture will reopen." },
    });

    this.parserRecoveryTimer = setTimeout(() => {
      this.parserRecoveryTimer = null;
      if (!this.pollTimer) return;
      void this.refreshCaptureSafely("parser-recovery");
    }, PARSER_RECOVERY_DELAY_MS);
    this.parserRecoveryTimer.unref();
  }

  private closeCapture(reason = "close"): void {
    if (!this.cap) return;
    const generation = this.activeCaptureGeneration;
    this.activeCaptureGeneration = null; // Reject any callback retained by the handle being closed.
    const reconfigure = ["reopen", "no-game-server-connections", "anti-cheat-waiting"].includes(reason);
    this.packetBuffers.discardObservation();
    this.emit({ observationGap: true, observationBoundary: this.packetBuffers.observationBoundary(),
      ...(reconfigure ? { observationGapSource: "gameplay-reconfigure" as const } : {}) });
    const targetCount = this.activeCaptureTargetCount;
    const connectionCount = this.activeCaptureConnectionCount;
    const closeStartedAt = Date.now();
    this.captureCloseAttempts += 1;
    this.lastCaptureCloseReason = reason;
    this.writeDebugLog("capture-close", {
      phase: "start",
      reason,
      generation,
      targetCount,
      connectionCount,
      counters: this.captureCounterSnapshot(),
      lifecycle: this.captureLifecycleSnapshot(),
    });

    let failure: string | null = null;
    try {
      this.cap.close();
      this.captureCloseCount += 1;
    } catch (error) {
      this.captureCloseFailures += 1;
      failure = sanitizeDebugSnippet(errorMessage(error), MAX_LOG_SNIPPET);
    }
    this.cap = null;
    this.activeCaptureGeneration = null;
    this.activeCaptureTargetCount = 0;
    this.activeCaptureConnectionCount = 0;
    this.activeLinkType = "";
    this.activeFilter = "";
    this.lastCaptureCloseAt = Date.now();

    const result = {
      reason,
      generation,
      targetCount,
      connectionCount,
      durationMs: Math.max(0, this.lastCaptureCloseAt - closeStartedAt),
      counters: this.captureCounterSnapshot(),
      lifecycle: this.captureLifecycleSnapshot(),
    };
    if (failure !== null) {
      this.writeDebugLog("capture-close-error", { ...result, error: failure });
      this.emit({
        log: { level: "warning", message: `Npcap handle close reported an error; capture recovery will continue: ${failure}` },
      });
      return;
    }
    this.writeDebugLog("capture-close-returned", result);
  }

  private probeGoldPayload(payloadText: string, events: ParsedEvent[]): void {
    if (events.some((event) => event.name === EVENT_NAMES.gold)) return;
    if (!/\b(?:gold|currency|gss|gsh|gns|gnh|gbp)\b/i.test(payloadText)) return;

    const now = Date.now();
    if (now - this.lastGoldProbeAt < 5000) return;
    this.lastGoldProbeAt = now;

    const snippet = payloadText.replace(/\s+/g, " ").slice(0, MAX_LOG_SNIPPET);
    this.emit({ log: { level: "debug", message: `Gold-like payload did not parse: ${snippet}` } });
  }

  private probeDebugPayload(payloadText: string, messages: MessageValue[], events: ParsedEvent[]): void {
    if (!this.loggingPreferences.captureDebugLogging || !this.loggingPreferences.capturePayloadLogging) return;
    if (!shouldDebugPayload(payloadText, messages, events)) return;
    if (isOnlyItemEvents(events) && !this.shouldWriteItemDebugPayload()) return;

    this.writeDebugLog("payload", {
      eventNames: events.map((event) => event.name),
      messageKeys: messages.map(messageKeySummary).filter(Boolean),
      snippet: sanitizeDebugSnippet(payloadText),
    });
  }

  private probeSatanicZonePayload(packet: ParsedPayload, payloadText: string, messages: MessageValue[], events: ParsedEvent[]): void {
    const requestCount = countSatanicZoneRequests(payloadText, messages);
    if (requestCount > 0) this.recordSatanicZoneRequests(packet, payloadText, requestCount);
    if (events.some((event) => event.name === EVENT_NAMES.satanicZone)) this.resolvePendingSatanicZoneRequests(packet, events);
  }

  private refreshCaptureFlows(connections: CaptureConnection[], now = Date.now()): void {
    this.packetBuffers.retainFlows(connections.map(connection => ({ src: connection.localAddress, srcPort: connection.localPort,
      dst: connection.remoteAddress, dstPort: connection.remotePort })));
    for (const connection of connections) {
      this.captureFlowExpirations.set(captureConnectionFlowKey(connection), now + CAPTURE_FLOW_GRACE_MS);
    }
    for (const [key, expiresAt] of this.captureFlowExpirations.entries()) {
      if (expiresAt <= now) this.captureFlowExpirations.delete(key);
    }
  }

  private isCaptureFlowPacket(packet: CapturePacketEndpoints, now = Date.now()): boolean {
    const key = capturePacketFlowKey(packet, this.activeLocalAddress);
    if (!key) return false;
    const expiresAt = this.captureFlowExpirations.get(key) ?? 0;
    if (expiresAt > now) return true;
    this.captureFlowExpirations.delete(key);
    return false;
  }

  private recordEndpointTraffic(packet: ParsedPayload, kind: "packet" | "payload"): void {
    const endpoint = endpointIdentity(packet, this.activeLocalAddress);
    if (!endpoint) return;

    const key = endpointKey(endpoint);
    const now = Date.now();
    const stats =
      this.endpointTrafficStats.get(key) ??
      {
        remoteAddress: endpoint.remoteAddress,
        remotePort: endpoint.remotePort,
        inboundPackets: 0,
        outboundPackets: 0,
        inboundPayloads: 0,
        outboundPayloads: 0,
        lastInboundAt: 0,
        lastOutboundAt: 0,
      };

    if (endpoint.direction === "outbound") {
      if (kind === "packet") stats.outboundPackets += 1;
      else stats.outboundPayloads += 1;
      stats.lastOutboundAt = now;
    } else {
      if (kind === "packet") stats.inboundPackets += 1;
      else stats.inboundPayloads += 1;
      stats.lastInboundAt = now;
    }
    this.endpointTrafficStats.set(key, stats);
  }

  private recordSatanicZoneRequests(packet: ParsedPayload, payloadText: string, requestCount: number): void {
    const endpoint = endpointIdentity(packet, this.activeLocalAddress);
    if (!endpoint || endpoint.direction !== "outbound") return;

    for (let requestIndex = 1; requestIndex <= requestCount; requestIndex += 1) {
      const id = ++this.satanicZoneRequestSequence;
      const requestedAt = Date.now();
      const timeout = setTimeout(() => this.expireSatanicZoneRequest(id), SATANIC_ZONE_RESPONSE_TIMEOUT_MS);
      timeout.unref();
      const pending: PendingSatanicZoneRequest = {
        id,
        requestIndex,
        requestCount,
        requestedAt,
        endpoint,
        snippet: this.loggingPreferences.satanicZoneDebugLogging ? sanitizeDebugSnippet(payloadText) : "",
        timeout,
      };
      this.pendingSatanicZoneRequests.set(id, pending);
      this.emit({ satanicZoneActivity: { kind: "request", observedAt: requestedAt } });
      if (this.loggingPreferences.satanicZoneDebugLogging) {
        this.writeDebugLog("satanic-zone-request", this.satanicZoneRequestLogData(pending));
      }
      this.trimPendingSatanicZoneRequests();
    }
  }

  private expireSatanicZoneRequest(id: number): void {
    const pending = this.pendingSatanicZoneRequests.get(id);
    if (!pending) return;

    this.pendingSatanicZoneRequests.delete(id);
    const timedOutAt = Date.now();
    this.emit({
      satanicZoneActivity: {
        kind: "timeout",
        observedAt: timedOutAt,
        requestedAt: pending.requestedAt,
      },
    });
    if (this.loggingPreferences.satanicZoneDebugLogging) {
      this.writeDebugLog("satanic-zone-request-timeout", {
        ...this.satanicZoneRequestLogData(pending),
        timedOutAt: new Date(timedOutAt).toISOString(),
        waitMs: timedOutAt - pending.requestedAt,
        pendingRequests: this.pendingSatanicZoneRequests.size,
        diagnostic:
          "Observed a satanic_zone_get request, but no updateSatanicZone event was parsed before the timeout. If inbound counts stay at zero for this endpoint, capture may be missing the backend response path.",
      });
    }
  }

  private resolvePendingSatanicZoneRequests(packet: ParsedPayload, events: ParsedEvent[]): void {
    if (this.pendingSatanicZoneRequests.size === 0) return;

    const responseEndpoint = endpointIdentity(packet, this.activeLocalAddress);
    const pending = Array.from(this.pendingSatanicZoneRequests.values());
    this.clearPendingSatanicZoneRequests();
    if (!this.loggingPreferences.satanicZoneDebugLogging) return;
    this.writeDebugLog("satanic-zone-request-resolved", {
      requestIds: pending.map((request) => request.id),
      resolvedAt: new Date().toISOString(),
      waitMs: pending.map((request) => Date.now() - request.requestedAt),
      responseEndpoint,
      responseEndpointTraffic: responseEndpoint ? endpointTrafficLogData(this.endpointTrafficStats.get(endpointKey(responseEndpoint))) : null,
      zoneEvents: events.filter((event) => event.name === EVENT_NAMES.satanicZone).map((event) => event.value),
    });
  }

  private trimPendingSatanicZoneRequests(): void {
    while (this.pendingSatanicZoneRequests.size > MAX_PENDING_SATANIC_ZONE_REQUESTS) {
      const oldest = this.pendingSatanicZoneRequests.values().next().value as PendingSatanicZoneRequest | undefined;
      if (!oldest) return;
      clearTimeout(oldest.timeout);
      this.pendingSatanicZoneRequests.delete(oldest.id);
    }
  }

  private clearPendingSatanicZoneRequests(): void {
    for (const pending of this.pendingSatanicZoneRequests.values()) clearTimeout(pending.timeout);
    this.pendingSatanicZoneRequests.clear();
  }

  private satanicZoneRequestLogData(pending: PendingSatanicZoneRequest): Record<string, unknown> {
    return {
      requestId: pending.id,
      requestIndex: pending.requestIndex,
      requestCount: pending.requestCount,
      requestedAt: new Date(pending.requestedAt).toISOString(),
      activeSignature: this.activeSignature || null,
      activeLocalAddress: this.activeLocalAddress || null,
      activeFilter: this.activeFilter || null,
      endpoint: pending.endpoint,
      endpointTraffic: endpointTrafficLogData(this.endpointTrafficStats.get(endpointKey(pending.endpoint))),
      timeoutMs: SATANIC_ZONE_RESPONSE_TIMEOUT_MS,
      snippet: pending.snippet,
    };
  }

  private writeDebugLog(type: string, data: Record<string, unknown>): void {
    if (!this.loggingPreferences.captureDebugLogging) return;
    appendJsonLog(this.debugLogPath, MAX_DEBUG_LOG_BYTES, type, data);
  }

  private writeWidePacketLog(packet: ParsedPayload, nbytes: number, truncated: boolean): void {
    if (!this.loggingPreferences.captureWideLogging) return;

    this.writeWideDebugLog("packet", {
      recordSequence: ++this.widePacketSequence,
      nbytes,
      truncated,
      linkType: this.activeLinkType || null,
      src: packet.src,
      srcPort: packet.srcPort,
      dst: packet.dst,
      dstPort: packet.dstPort,
      tcpSequence: packet.seq,
      ack: packet.ack ?? null,
      tcpFlags: packet.flags,
      payloadLength: packet.payloadLength,
      nullBytes: packet.payload.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0),
      textSnippet: sanitizeDebugSnippet(packet.text, 4000),
    });
  }

  private writeWidePayloadLog(packet: ParsedPayload, payloadText: string): void {
    if (!this.loggingPreferences.captureWideLogging) return;

    this.writeWideDebugLog("assembled-payload", {
      recordSequence: ++this.widePayloadSequence,
      src: packet.src,
      srcPort: packet.srcPort,
      dst: packet.dst,
      dstPort: packet.dstPort,
      tcpSequence: packet.seq,
      ack: packet.ack ?? null,
      parseableCandidate: isLikelyParseablePayload(payloadText),
      textLength: payloadText.length,
      textSnippet: sanitizeDebugSnippet(payloadText, 4000),
    });
  }

  private writeWideDebugLog(type: string, data: Record<string, unknown>): void {
    if (!this.loggingPreferences.captureWideLogging || !this.wideDebugLogPath) return;
    appendJsonLog(this.wideDebugLogPath, MAX_WIDE_DEBUG_LOG_BYTES, type, data);
  }

  private shouldWriteItemDebugPayload(): boolean {
    const now = Date.now();
    if (now - this.lastItemDebugPayloadAt < ITEM_DEBUG_PAYLOAD_INTERVAL_MS) return false;
    this.lastItemDebugPayloadAt = now;
    return true;
  }

  private startDiagnosticHeartbeat(): void {
    if (this.diagnosticHeartbeatTimer) return;
    this.diagnosticHeartbeatTimer = setInterval(() => this.writeDiagnosticHeartbeat(), CAPTURE_DIAGNOSTIC_HEARTBEAT_MS);
    this.diagnosticHeartbeatTimer.unref();
    this.writeDiagnosticHeartbeat();
  }

  private writeDiagnosticHeartbeat(): void {
    this.writeDebugLog("capture-heartbeat", {
      capOpen: Boolean(this.cap),
      captureRequested: this.captureRequested,
      refreshInFlight: this.refreshInFlight,
      activeLocalAddress: this.activeLocalAddress || null,
      activeLinkType: this.activeLinkType || null,
      activeSignature: this.activeSignature || null,
      activeFilter: this.activeFilter || null,
      activeTargetCount: this.activeCaptureTargetCount,
      activeConnectionCount: this.activeCaptureConnectionCount,
      lastCaptureOpenAt: toIsoOrNull(this.lastCaptureOpenAt),
      lastCaptureCloseAt: toIsoOrNull(this.lastCaptureCloseAt),
      lastCaptureCloseReason: this.lastCaptureCloseReason || null,
      lastRefreshAt: toIsoOrNull(this.lastRefreshAt),
      lastPacketAt: toIsoOrNull(this.lastPacketAt),
      lastPayloadAt: toIsoOrNull(this.lastPayloadAt),
      lastEventAt: toIsoOrNull(this.lastEventAt),
      counters: this.captureCounterSnapshot(),
      lifecycle: this.captureLifecycleSnapshot(),
      packetBuffers: this.packetBuffers.stats(),
      recentEventFingerprints: this.eventDeduplicator.size,
    });
  }

  private captureCounterSnapshot(): Record<string, number> {
    return {
      packetsSeen: this.packetsSeen,
      payloadsAssembled: this.payloadsAssembled,
      messagesDecoded: this.messagesDecoded,
      parsedEvents: this.parsedEvents,
      parserErrors: this.parserErrors,
      parserRestarts: this.parserRestarts,
    };
  }

  private captureLifecycleSnapshot(): Record<string, number | null> {
    return {
      generationSequence: this.captureGenerationSequence,
      activeGeneration: this.activeCaptureGeneration,
      openAttempts: this.captureOpenAttempts,
      opens: this.captureOpenCount,
      reopens: this.captureReopenCount,
      closeAttempts: this.captureCloseAttempts,
      closes: this.captureCloseCount,
      closeFailures: this.captureCloseFailures,
    };
  }
}

function gameOwnedConnections(networkState: HeroSiegeNetworkState): CaptureConnection[] {
  const gameProcessIds = new Set(networkState.gameProcessIds);
  return networkState.connections.filter((connection) => gameProcessIds.has(connection.owningProcess));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function captureLoggingPreferences(preferences: CapturePreferences | boolean): CapturePreferences {
  if (typeof preferences === "boolean") {
    return {
      captureDebugLogging: true,
      capturePayloadLogging: preferences,
      captureWideLogging: preferences,
      satanicZoneDebugLogging: true,
    };
  }
  return {
    captureDebugLogging: preferences.captureDebugLogging,
    capturePayloadLogging: preferences.capturePayloadLogging,
    captureWideLogging: preferences.captureWideLogging,
    satanicZoneDebugLogging: preferences.satanicZoneDebugLogging,
  };
}

function capturePreferencesEqual(left: CapturePreferences, right: CapturePreferences): boolean {
  return (
    left.captureDebugLogging === right.captureDebugLogging &&
    left.capturePayloadLogging === right.capturePayloadLogging &&
    left.captureWideLogging === right.captureWideLogging &&
    left.satanicZoneDebugLogging === right.satanicZoneDebugLogging
  );
}

function countSatanicZoneRequests(payloadText: string, messages: MessageValue[]): number {
  const textMatches = payloadText.match(/\bsatanic_zone_get[A-Z]?(?=[A-Za-z_]+=|\s|$)/gi)?.length ?? 0;
  const messageMatches = messages.filter((message) => messageHasRoute(message, new RegExp(`^${SATANIC_ZONE_REQUEST_ROUTE}$`, "i"))).length;
  return Math.max(textMatches, messageMatches);
}

function endpointIdentity(packet: ParsedPayload, activeLocalAddress: string): EndpointIdentity | null {
  if (!activeLocalAddress) return null;
  if (packet.src === activeLocalAddress) {
    return {
      direction: "outbound",
      localAddress: packet.src,
      localPort: packet.srcPort,
      remoteAddress: packet.dst,
      remotePort: packet.dstPort,
    };
  }
  if (packet.dst === activeLocalAddress) {
    return {
      direction: "inbound",
      localAddress: packet.dst,
      localPort: packet.dstPort,
      remoteAddress: packet.src,
      remotePort: packet.srcPort,
    };
  }
  return null;
}

function endpointKey(endpoint: EndpointIdentity | EndpointTrafficStats): string {
  return `${endpoint.remoteAddress}:${endpoint.remotePort}`;
}

function endpointTrafficLogData(stats: EndpointTrafficStats | undefined): Record<string, unknown> | null {
  if (!stats) return null;
  return {
    remoteAddress: stats.remoteAddress,
    remotePort: stats.remotePort,
    inboundPackets: stats.inboundPackets,
    outboundPackets: stats.outboundPackets,
    inboundPayloads: stats.inboundPayloads,
    outboundPayloads: stats.outboundPayloads,
    lastInboundAt: toIsoOrNull(stats.lastInboundAt),
    lastOutboundAt: toIsoOrNull(stats.lastOutboundAt),
  };
}

function toIsoOrNull(timestamp: number): string | null {
  return timestamp > 0 ? new Date(timestamp).toISOString() : null;
}
