import { findNpcapDevice, listNpcapDevices, openPacketCapture, type PacketCaptureHandle } from "./capture-adapter";
import { appendJsonLog, sanitizeDebugSnippet } from "./capture-debug";
import {
  isOnlyItemEvents,
  messageHasRoute,
  messageKeySummary,
  shouldDebugPayload,
  shouldLogEvent,
  summarizeEvent,
} from "./capture-events";
import { GeneratedDropCorrelator, RecentEventDeduplicator } from "./capture-event-state";
import {
  connectionSignature,
  getHeroSiegeNetworkState,
  getNpcapRegistry,
  getNpcapServiceStatus,
  selectGameServerConnections,
  stableCaptureFilter,
  summarizeConnections,
  uniqueCaptureTargets,
  type HeroSiegeNetworkState,
} from "./capture-network";
import { getPayload, isLikelyParseablePayload, PacketBuffers, type ParsedPayload } from "./packet-decoder";
import type { CaptureConnection, CaptureHealth } from "../shared/app-state";
import { EVENT_NAMES } from "../shared/constants";
import type { MessageValue } from "../shared/fields";
import { captureMessages, messageToEvents, type ParsedEvent } from "../shared/parser";

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
const SATANIC_ZONE_RESPONSE_TIMEOUT_MS = 10_000;
const MAX_PENDING_SATANIC_ZONE_REQUESTS = 100;
const SUPPORTED_LINK_TYPES = new Set(["ETHERNET", "RAW", "NULL", "LINKTYPE_LINUX_SLL"]);
const SATANIC_ZONE_REQUEST_ROUTE = "satanic_zone_get";

export interface CaptureUpdate {
  connections?: CaptureConnection[];
  health?: Partial<CaptureHealth>;
  events?: ParsedEvent[];
  log?: { level: "info" | "success" | "warning" | "error" | "debug"; message: string };
  logs?: Array<{ level: "info" | "success" | "warning" | "error" | "debug"; message: string }>;
  running?: boolean;
  status?: "idle" | "waiting" | "running" | "error";
  error?: string | null;
}

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
  private lastCaptureOpenAt = 0;
  private lastRefreshAt = 0;
  private lastPacketAt = 0;
  private lastPayloadAt = 0;
  private lastEventAt = 0;
  private readonly packetBuffers = new PacketBuffers();
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
  private readonly pendingSatanicZoneRequests = new Map<number, PendingSatanicZoneRequest>();
  private readonly eventDeduplicator = new RecentEventDeduplicator();
  private readonly generatedDropCorrelator = new GeneratedDropCorrelator();

  constructor(
    private readonly emit: (update: CaptureUpdate) => void,
    private readonly debugLogPath?: string,
    private readonly wideDebugLogPath?: string,
    private createDebugMode = false,
  ) {}

  setCreateDebugMode(enabled: boolean): void {
    if (this.createDebugMode === enabled) return;
    this.createDebugMode = enabled;
    this.writeDebugLog("wide-capture-mode", {
      enabled,
      wideDebugLogPath: this.wideDebugLogPath ?? null,
    });
    this.writeWideDebugLog("wide-capture-mode", {
      enabled,
      activeSignature: this.activeSignature || null,
      activeLinkType: this.activeLinkType || null,
    });
  }

  async diagnostics(): Promise<Partial<CaptureHealth>> {
    const registry = await getNpcapRegistry();
    return {
      npcapService: await getNpcapServiceStatus(),
      winPcapCompatible: registry.winPcapCompatible,
      adminOnly: registry.adminOnly,
    };
  }

  async hasHeroSiegeProcess(): Promise<boolean> {
    return (await getHeroSiegeNetworkState()).gameProcessIds.length > 0;
  }

  async start(): Promise<void> {
    if (this.captureRequested || this.pollTimer) return;
    this.captureRequested = true;

    const initialNetworkState = await getHeroSiegeNetworkState();
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

    if (initialNetworkState.antiCheatProcessIds.length > 0 && initialNetworkState.connections.length === 0) {
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
    this.writeDebugLog("capture-start", { debugLogPath: this.debugLogPath, wideDebugLogPath: this.wideDebugLogPath });
    await this.refreshCapture(initialNetworkState);
    if (!this.captureRequested) return;
    this.startDiagnosticHeartbeat();
    this.pollTimer = setInterval(() => void this.refreshCaptureSafely("poll"), POLL_INTERVAL_MS);
  }

  stop(): void {
    this.captureRequested = false;
    this.stopTimers();
    this.resetCaptureSession();
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
    this.resetPacketState();
  }

  private resetPacketState(): void {
    this.packetBuffers.clear();
    this.eventDeduplicator.clear();
    this.generatedDropCorrelator.clear();
    this.endpointTrafficStats.clear();
    this.clearPendingSatanicZoneRequests();
  }

  private async refreshCaptureSafely(source: string): Promise<void> {
    try {
      await this.refreshCapture();
    } catch (error) {
      if (!this.captureRequested) return;
      this.writeDebugLog("capture-refresh-error", {
        source,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
        capOpen: Boolean(this.cap),
        activeSignature: this.activeSignature,
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
    }
  }

  private async refreshCapture(networkState?: HeroSiegeNetworkState): Promise<void> {
    if (!this.captureRequested) return;
    this.lastRefreshAt = Date.now();
    const currentNetworkState = networkState ?? (await getHeroSiegeNetworkState());
    if (!this.captureRequested) return;
    const connections = currentNetworkState.connections;
    this.emit({ connections });

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

    if (currentNetworkState.antiCheatProcessIds.length > 0 && connections.length === 0) {
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

    if (signature === this.activeSignature && this.cap) return;

    const localAddress = unique(captureConnections.map((connection) => connection.localAddress))[0] ?? "";
    if (this.cap && localAddress === this.activeLocalAddress) {
      const previousSignature = this.activeSignature;
      this.activeSignature = signature;
      this.writeDebugLog("capture-connections-updated", {
        previousSignature,
        activeSignature: signature,
        filterKept: true,
        connections: summarizeConnections(connections),
      });
      return;
    }

    this.openCapture(signature, captureConnections, connections);
  }

  private openCapture(signature: string, connections: CaptureConnection[], allConnections = connections): void {
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

    const filter = stableCaptureFilter(localAddress);

    try {
      this.closeCapture("reopen");
      const openedCapture = openPacketCapture(device, filter, this.buffer, (nbytes, truncated) => this.onPacket(nbytes, truncated));
      const linkType = openedCapture.linkType;
      this.cap = openedCapture.cap;
      this.activeSignature = signature;
      this.activeLocalAddress = localAddress;
      this.activeLinkType = linkType;
      this.lastCaptureOpenAt = Date.now();
      this.resetPacketState();
      this.writeDebugLog("capture-open", {
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
      this.writeDebugLog("capture-open-error", {
        error: error instanceof Error ? error.message : String(error),
        filter,
        targets,
        connections: summarizeConnections(allConnections),
      });
      this.emit({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        log: { level: "error", message: `Capture failed: ${error instanceof Error ? error.message : String(error)}` },
      });
    }
  }

  private onPacket(nbytes: number, truncated: boolean): void {
    try {
      this.processPacket(nbytes, truncated);
    } catch (error) {
      this.recordParserFailure("packet", error, "");
    }
  }

  private processPacket(nbytes: number, truncated: boolean): void {
    if (truncated) this.emit({ log: { level: "warning", message: "Npcap truncated a packet." } });

    const parsedPacket = getPayload(this.buffer, nbytes, this.activeLinkType);
    if (!parsedPacket) return;

    this.lastPacketAt = Date.now();
    this.packetsSeen += 1;
    this.recordEndpointTraffic(parsedPacket, "packet");
    this.writeWidePacketLog(parsedPacket, nbytes, truncated);
    const completedPayloads = this.packetBuffers.push(parsedPacket);
    const events: ParsedEvent[] = [];

    for (const completedPayload of completedPayloads) {
      const { packet, text: payloadText } = completedPayload;
      this.recordEndpointTraffic(packet, "payload");
      this.writeWidePayloadLog(packet, payloadText);
      if (!isLikelyParseablePayload(payloadText)) continue;
      if (payloadText.length > MAX_PARSE_PAYLOAD_CHARS) {
        this.recordParserFailure("payload-size", new Error(`Payload exceeded ${MAX_PARSE_PAYLOAD_CHARS} characters.`), payloadText);
        continue;
      }

      this.payloadsAssembled += 1;
      this.lastPayloadAt = Date.now();
      const messages = this.captureMessagesSafely(payloadText);
      if (!messages) continue;
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
      this.runParserProbeSafely("gold-payload", () => this.probeGoldPayload(payloadText, usefulEvents), payloadText);
    }

    if (events.length === 0) {
      this.emit({
        health: {
          packetsSeen: this.packetsSeen,
          payloadsAssembled: this.payloadsAssembled,
          messagesDecoded: this.messagesDecoded,
        },
      });
      return;
    }

    this.parsedEvents += events.length;
    this.lastEventAt = Date.now();
    const loggableEvents = events.filter((event) => shouldLogEvent(event));
    const eventLogs = loggableEvents.map((event) => ({ level: "debug" as const, message: summarizeEvent(event) }));
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
      log: eventLogs.length === 1 ? eventLogs[0] : undefined,
      logs: eventLogs.length > 1 ? eventLogs : undefined,
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
    try {
      this.writeDebugLog("capture-close", { reason, activeSignature: this.activeSignature });
      this.cap.close();
    } catch {
      // The native module may throw if the handle is already closing.
    }
    this.cap = null;
    this.activeLinkType = "";
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
    if (!shouldDebugPayload(payloadText, messages, events)) return;
    if (isOnlyItemEvents(events) && !this.createDebugMode && !this.shouldWriteItemDebugPayload()) return;

    this.writeDebugLog("payload", {
      eventNames: events.map((event) => event.name),
      messageKeys: messages.map(messageKeySummary).filter(Boolean),
      snippet: sanitizeDebugSnippet(payloadText),
    });
  }

  private probeSatanicZonePayload(packet: ParsedPayload, payloadText: string, messages: MessageValue[], events: ParsedEvent[]): void {
    const requestCount = countSatanicZoneRequests(payloadText, messages);
    if (requestCount > 0) this.recordSatanicZoneRequests(packet, payloadText, requestCount);
    if (events.some((event) => event.name === EVENT_NAMES.satanicZone)) this.resolvePendingSatanicZoneRequests(events);
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
        snippet: sanitizeDebugSnippet(payloadText),
        timeout,
      };
      this.pendingSatanicZoneRequests.set(id, pending);
      this.writeDebugLog("satanic-zone-request", this.satanicZoneRequestLogData(pending));
      this.trimPendingSatanicZoneRequests();
    }
  }

  private expireSatanicZoneRequest(id: number): void {
    const pending = this.pendingSatanicZoneRequests.get(id);
    if (!pending) return;

    this.pendingSatanicZoneRequests.delete(id);
    this.writeDebugLog("satanic-zone-request-timeout", {
      ...this.satanicZoneRequestLogData(pending),
      timedOutAt: new Date().toISOString(),
      waitMs: Date.now() - pending.requestedAt,
      pendingRequests: this.pendingSatanicZoneRequests.size,
      diagnostic:
        "Observed a satanic_zone_get request, but no updateSatanicZone event was parsed before the timeout. If inbound counts stay at zero for this endpoint, capture may be missing the backend response path.",
    });
  }

  private resolvePendingSatanicZoneRequests(events: ParsedEvent[]): void {
    if (this.pendingSatanicZoneRequests.size === 0) return;

    const pending = Array.from(this.pendingSatanicZoneRequests.values());
    this.clearPendingSatanicZoneRequests();
    this.writeDebugLog("satanic-zone-request-resolved", {
      requestIds: pending.map((request) => request.id),
      resolvedAt: new Date().toISOString(),
      waitMs: pending.map((request) => Date.now() - request.requestedAt),
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
      endpoint: pending.endpoint,
      endpointTraffic: endpointTrafficLogData(this.endpointTrafficStats.get(endpointKey(pending.endpoint))),
      timeoutMs: SATANIC_ZONE_RESPONSE_TIMEOUT_MS,
      snippet: pending.snippet,
    };
  }

  private writeDebugLog(type: string, data: Record<string, unknown>): void {
    appendJsonLog(this.debugLogPath, MAX_DEBUG_LOG_BYTES, type, data);
  }

  private writeWidePacketLog(packet: ParsedPayload, nbytes: number, truncated: boolean): void {
    if (!this.createDebugMode) return;

    this.writeWideDebugLog("packet", {
      seq: ++this.widePacketSequence,
      nbytes,
      truncated,
      linkType: this.activeLinkType || null,
      src: packet.src,
      srcPort: packet.srcPort,
      dst: packet.dst,
      dstPort: packet.dstPort,
      ack: packet.ack ?? null,
      payloadLength: packet.payloadLength,
      textSnippet: sanitizeDebugSnippet(packet.text, 4000),
    });
  }

  private writeWidePayloadLog(packet: ParsedPayload, payloadText: string): void {
    if (!this.createDebugMode) return;

    this.writeWideDebugLog("assembled-payload", {
      seq: ++this.widePayloadSequence,
      src: packet.src,
      srcPort: packet.srcPort,
      dst: packet.dst,
      dstPort: packet.dstPort,
      ack: packet.ack ?? null,
      parseableCandidate: isLikelyParseablePayload(payloadText),
      textLength: payloadText.length,
      textSnippet: sanitizeDebugSnippet(payloadText, 4000),
    });
  }

  private writeWideDebugLog(type: string, data: Record<string, unknown>): void {
    if (!this.createDebugMode || !this.wideDebugLogPath) return;
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
      activeLocalAddress: this.activeLocalAddress || null,
      activeLinkType: this.activeLinkType || null,
      activeSignature: this.activeSignature || null,
      lastCaptureOpenAt: toIsoOrNull(this.lastCaptureOpenAt),
      lastRefreshAt: toIsoOrNull(this.lastRefreshAt),
      lastPacketAt: toIsoOrNull(this.lastPacketAt),
      lastPayloadAt: toIsoOrNull(this.lastPayloadAt),
      lastEventAt: toIsoOrNull(this.lastEventAt),
      counters: {
        packetsSeen: this.packetsSeen,
        payloadsAssembled: this.payloadsAssembled,
        messagesDecoded: this.messagesDecoded,
        parsedEvents: this.parsedEvents,
        parserErrors: this.parserErrors,
        parserRestarts: this.parserRestarts,
      },
      packetBuffers: this.packetBuffers.stats(),
      recentEventFingerprints: this.eventDeduplicator.size,
    });
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
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
