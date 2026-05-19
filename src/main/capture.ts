import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import type { CaptureConnection, CaptureHealth } from "../shared/app-state";
import { EVENT_NAMES } from "../shared/constants";
import type { MessageValue } from "../shared/fields";
import { captureMessages, messageToEvents, type ParsedEvent } from "../shared/parser";

const capRequire = createRequire(__filename);
const { Cap, decoders } = capRequire("cap") as any;

const PROTOCOL = decoders.PROTOCOL;
const MAX_LOG_SNIPPET = 180;
const MAX_DEBUG_SNIPPET = 1200;
const MAX_DEBUG_LOG_BYTES = 10 * 1024 * 1024;
const POLL_INTERVAL_MS = 1000;
const CAPTURE_DIAGNOSTIC_HEARTBEAT_MS = 15_000;
const EVENT_DEDUP_WINDOW_MS = 2500;
const MAX_PARSE_PAYLOAD_CHARS = 1_000_000;
const PARSER_FAILURE_RESTART_THRESHOLD = 3;
const PARSER_RECOVERY_DELAY_MS = 750;
const PARSER_ERROR_LOG_INTERVAL_MS = 5000;
const ITEM_DEBUG_PAYLOAD_INTERVAL_MS = 10_000;
// Hero Siege gameplay traffic does not currently use HTTP/HTTPS ports.
// Exclude these transient launcher/CDN connections so they are not captured or logged.
const WEB_REMOTE_PORTS = new Set([80, 443]);

export interface CaptureUpdate {
  connections?: CaptureConnection[];
  health?: Partial<CaptureHealth>;
  events?: ParsedEvent[];
  log?: { level: "info" | "success" | "warning" | "error" | "debug"; message: string };
  running?: boolean;
  status?: "idle" | "waiting" | "running" | "error";
  error?: string | null;
}

interface HeroSiegeNetworkState {
  gameProcessIds: number[];
  antiCheatProcessIds: number[];
  connections: CaptureConnection[];
}

interface PowerShellConnectionEntry {
  OwningProcess: unknown;
  State: unknown;
  LocalAddress: unknown;
  LocalPort: unknown;
  RemoteAddress: unknown;
  RemotePort: unknown;
}

export class CaptureService {
  private cap: any = null;
  private buffer = Buffer.alloc(65535);
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
  private readonly recentEventFingerprints = new Map<string, number>();

  constructor(
    private readonly emit: (update: CaptureUpdate) => void,
    private readonly debugLogPath?: string,
  ) {}

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
    if (this.pollTimer) return;

    const initialNetworkState = await getHeroSiegeNetworkState();
    if (initialNetworkState.gameProcessIds.length === 0) {
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
    this.writeDebugLog("capture-start", { debugLogPath: this.debugLogPath });
    await this.refreshCapture(initialNetworkState);
    this.startDiagnosticHeartbeat();
    this.pollTimer = setInterval(() => void this.refreshCaptureSafely("poll"), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.parserRecoveryTimer) clearTimeout(this.parserRecoveryTimer);
    if (this.diagnosticHeartbeatTimer) clearInterval(this.diagnosticHeartbeatTimer);
    this.pollTimer = null;
    this.parserRecoveryTimer = null;
    this.diagnosticHeartbeatTimer = null;
    this.closeCapture();
    this.activeSignature = "";
    this.activeLocalAddress = "";
    this.packetBuffers.clear();
    this.recentEventFingerprints.clear();
    this.emit({ running: false, status: "idle", health: { device: null, filter: "" }, log: { level: "info", message: "Capture stopped." } });
  }

  private async refreshCaptureSafely(source: string): Promise<void> {
    try {
      await this.refreshCapture();
    } catch (error) {
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
    this.lastRefreshAt = Date.now();
    const currentNetworkState = networkState ?? (await getHeroSiegeNetworkState());
    const connections = currentNetworkState.connections;
    this.emit({ connections });

    if (currentNetworkState.antiCheatProcessIds.length > 0 && connections.length === 0) {
      this.closeCapture();
      this.activeSignature = "";
      this.activeLocalAddress = "";
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
      this.activeSignature = "";
      this.activeLocalAddress = "";
      this.closeCapture("no-game-server-connections");
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

    const device = Cap.findDevice(localAddress);
    if (!device) {
      const devices = Cap.deviceList()
        .map((deviceInfo: any) => {
          const addresses = (deviceInfo.addresses ?? []).map((address: any) => address.addr).filter(Boolean).join(", ");
          return `${deviceInfo.name}${addresses ? ` (${addresses})` : ""}`;
        })
        .join("; ");
      this.closeCapture("adapter-missing");
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
      const nextCap = new Cap();
      const linkType = nextCap.open(device, filter, 10 * 1024 * 1024, this.buffer);
      nextCap.on("packet", (nbytes: number, truncated: boolean) => this.onPacket(nbytes, truncated));
      this.cap = nextCap;
      this.activeSignature = signature;
      this.activeLocalAddress = localAddress;
      this.lastCaptureOpenAt = Date.now();
      this.packetBuffers.clear();
      this.recentEventFingerprints.clear();
      this.writeDebugLog("capture-open", {
        device,
        filter,
        linkType,
        targets,
        connections: summarizeConnections(allConnections),
      });
      this.emit({
        status: "running",
        health: { device, filter },
        log: { level: "success", message: `Capture opened on ${device} (${linkType}).` },
      });
    } catch (error) {
      this.closeCapture("open-error");
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

    const parsedPacket = getPayload(this.buffer, nbytes);
    if (!parsedPacket) return;

    this.lastPacketAt = Date.now();
    this.packetsSeen += 1;
    const completedPayloads = this.packetBuffers.push(parsedPacket);
    const events: ParsedEvent[] = [];

    for (const payloadText of completedPayloads) {
      if (!isLikelyParseablePayload(payloadText)) continue;
      if (payloadText.length > MAX_PARSE_PAYLOAD_CHARS) {
        this.recordParserFailure("payload-size", new Error(`Payload exceeded ${MAX_PARSE_PAYLOAD_CHARS} characters.`), payloadText);
        continue;
      }

      this.payloadsAssembled += 1;
      this.lastPayloadAt = Date.now();
      const messages = this.captureMessagesSafely(payloadText);
      if (!messages) continue;
      this.messagesDecoded += messages.length;
      const nextEvents = this.messageToEventsSafely(messages, payloadText);
      if (!nextEvents) continue;
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
    const sample = summarizeEvent(events[0]);
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
      log: shouldLogEvent(events[0]) ? { level: "debug", message: sample } : undefined,
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
      return events.filter(isUsefulEvent).filter((event) => !this.isDuplicateEvent(event));
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
    this.packetBuffers.clear();
    this.recentEventFingerprints.clear();
    this.closeCapture("parser-recovery");
    this.activeSignature = "";
    this.activeLocalAddress = "";
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
  }

  private isDuplicateEvent(event: ParsedEvent): boolean {
    const now = Date.now();
    this.pruneRecentEventFingerprints(now);

    const fingerprint = eventFingerprint(event);
    const lastSeenAt = this.recentEventFingerprints.get(fingerprint);
    if (lastSeenAt && now - lastSeenAt <= EVENT_DEDUP_WINDOW_MS) return true;

    this.recentEventFingerprints.set(fingerprint, now);
    return false;
  }

  private pruneRecentEventFingerprints(now: number): void {
    if (this.recentEventFingerprints.size < 1000) return;

    for (const [fingerprint, seenAt] of this.recentEventFingerprints.entries()) {
      if (now - seenAt > EVENT_DEDUP_WINDOW_MS) this.recentEventFingerprints.delete(fingerprint);
    }
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
    if (isOnlyItemEvents(events) && !this.shouldWriteItemDebugPayload()) return;

    this.writeDebugLog("payload", {
      eventNames: events.map((event) => event.name),
      messageKeys: messages.map(messageKeySummary).filter(Boolean),
      snippet: sanitizeDebugSnippet(payloadText),
    });
  }

  private writeDebugLog(type: string, data: Record<string, unknown>): void {
    if (!this.debugLogPath) return;

    try {
      rotateLogIfLarge(this.debugLogPath, MAX_DEBUG_LOG_BYTES);
      fs.appendFileSync(this.debugLogPath, `${JSON.stringify({ type, at: new Date().toISOString(), ...data })}\n`, "utf8");
    } catch {
      // Diagnostics must never interfere with packet capture.
    }
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
      recentEventFingerprints: this.recentEventFingerprints.size,
    });
  }
}

interface ParsedPayload {
  src: string;
  dst: string;
  srcPort: number;
  dstPort: number;
  ack: number | undefined;
  text: string;
}

class PacketBuffers {
  private lastAckBySource = new Map<string, string>();
  private chunksByAck = new Map<string, string[]>();

  push(packet: ParsedPayload): string[] {
    const sourceKey = `${packet.src}:${packet.srcPort}->${packet.dst}:${packet.dstPort}`;
    const ackKey = `${sourceKey}:${packet.ack ?? "noack"}`;
    const previousAck = this.lastAckBySource.get(sourceKey);
    const completed: string[] = [];

    if (!this.chunksByAck.has(ackKey)) this.chunksByAck.set(ackKey, []);
    this.chunksByAck.get(ackKey)?.push(packet.text);

    if (previousAck && previousAck !== ackKey) {
      const chunks = this.chunksByAck.get(previousAck);
      if (chunks?.length) {
        completed.push(chunks.join(""));
        this.chunksByAck.delete(previousAck);
      }
    }

    this.lastAckBySource.set(sourceKey, ackKey);

    if (packet.text.includes("{") || packet.text.includes("[") || packet.text.includes("&") || looksLikeSpecialProtocol(packet.text)) {
      completed.push(packet.text);
    }

    if (this.chunksByAck.size > 300) this.clear();
    return completed;
  }

  clear(): void {
    this.lastAckBySource.clear();
    this.chunksByAck.clear();
  }

  stats(): { sources: number; ackBuffers: number; bufferedChunks: number } {
    let bufferedChunks = 0;
    for (const chunks of this.chunksByAck.values()) bufferedChunks += chunks.length;
    return {
      sources: this.lastAckBySource.size,
      ackBuffers: this.chunksByAck.size,
      bufferedChunks,
    };
  }
}

function getPayload(buffer: Buffer, nbytes: number): ParsedPayload | null {
  let cursor = decoders.Ethernet(buffer);
  if (cursor.info.type !== PROTOCOL.ETHERNET.IPV4) return null;

  const ip = decoders.IPV4(buffer, cursor.offset);
  if (ip.info.protocol !== PROTOCOL.IP.TCP) return null;

  const tcp = decoders.TCP(buffer, ip.offset);
  if (tcp.offset >= nbytes) return null;

  const payload = buffer.subarray(tcp.offset, nbytes);
  if (payload.length === 0) return null;

  return {
    src: ip.info.srcaddr,
    dst: ip.info.dstaddr,
    srcPort: tcp.info.srcport,
    dstPort: tcp.info.dstport,
    ack: tcp.info.ackno,
    text: payload.toString("utf8").replace(/\0/g, ""),
  };
}

async function getHeroSiegeNetworkState(): Promise<HeroSiegeNetworkState> {
  const script = `
    $processes = Get-Process |
      Where-Object {
        $normalizedName = ($_.ProcessName -replace '[^a-zA-Z0-9]', '').ToLowerInvariant();
        $normalizedName.StartsWith('herosiege') -and
        -not $normalizedName.Contains('companion')
      };

    $antiCheatProcesses = Get-Process |
      Where-Object {
        (($_.ProcessName -replace '[^a-zA-Z0-9]', '').ToLowerInvariant()).StartsWith('easyanticheat')
      };

    $processIds = @($processes | Select-Object -ExpandProperty Id);
    $connections = @();

    if ($processIds.Count -gt 0) {
      $connections = @(
        Get-NetTCPConnection -ErrorAction SilentlyContinue |
          Where-Object {
            $processIds -contains $_.OwningProcess -and
            $_.RemoteAddress -and
            $_.RemoteAddress -notin @('0.0.0.0', '::', '127.0.0.1', '::1') -and
            $_.RemoteAddress -notlike '*:*'
          } |
          Select-Object OwningProcess, State, LocalAddress, LocalPort, RemoteAddress, RemotePort
      );
    }

    [PSCustomObject]@{
      gameProcessIds = @($processIds);
      antiCheatProcessIds = @($antiCheatProcesses | Select-Object -ExpandProperty Id);
      connections = @($connections);
    } | ConvertTo-Json -Compress
  `;

  const output = await runPowerShell(script);
  if (!output) return { gameProcessIds: [], antiCheatProcessIds: [], connections: [] };

  try {
    const parsed = JSON.parse(output) as any;
    const entries: PowerShellConnectionEntry[] = Array.isArray(parsed.connections)
      ? parsed.connections
      : parsed.connections
        ? [parsed.connections]
        : [];
    return {
      gameProcessIds: normalizeNumberArray(parsed.gameProcessIds),
      antiCheatProcessIds: normalizeNumberArray(parsed.antiCheatProcessIds),
      connections: entries.map((entry) => ({
        owningProcess: Number(entry.OwningProcess),
        state: String(entry.State),
        localAddress: String(entry.LocalAddress),
        localPort: Number(entry.LocalPort),
        remoteAddress: String(entry.RemoteAddress),
        remotePort: Number(entry.RemotePort),
      })),
    };
  } catch {
    return { gameProcessIds: [], antiCheatProcessIds: [], connections: [] };
  }
}

function normalizeNumberArray(value: unknown): number[] {
  const values = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return values.map(Number).filter(Number.isFinite);
}

async function getNpcapServiceStatus(): Promise<string> {
  const output = await runPowerShell("Get-Service npcap -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status");
  return output || "Unknown";
}

async function getNpcapRegistry(): Promise<{ adminOnly: boolean; winPcapCompatible: boolean }> {
  const output = await runPowerShell(
    "Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\WOW6432Node\\Npcap' -ErrorAction SilentlyContinue | Select-Object AdminOnly,WinPcapCompatible | ConvertTo-Json -Compress",
  );
  if (!output) return { adminOnly: false, winPcapCompatible: false };

  try {
    const parsed = JSON.parse(output) as any;
    return {
      adminOnly: Number(parsed.AdminOnly) === 1,
      winPcapCompatible: Number(parsed.WinPcapCompatible) === 1,
    };
  } catch {
    return { adminOnly: false, winPcapCompatible: false };
  }
}

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (_error, stdout) => resolve(stdout.trim()),
    );
  });
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

interface CaptureTarget {
  remoteAddress: string;
  remotePort: number;
}

function selectGameServerConnections(connections: CaptureConnection[]): CaptureConnection[] {
  return connections.filter((connection) => !isLikelyWebConnection(connection));
}

function isLikelyWebConnection(connection: CaptureConnection): boolean {
  return WEB_REMOTE_PORTS.has(Number(connection.remotePort));
}

function uniqueCaptureTargets(connections: CaptureConnection[]): CaptureTarget[] {
  const seen = new Set<string>();
  const targets: CaptureTarget[] = [];
  for (const connection of connections) {
    const key = `${connection.remoteAddress}:${connection.remotePort}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ remoteAddress: connection.remoteAddress, remotePort: Number(connection.remotePort) });
  }
  return targets;
}

function stableCaptureFilter(localAddress: string): string {
  const webPortFilter = Array.from(WEB_REMOTE_PORTS)
    .map((port) => `port ${port}`)
    .join(" or ");
  return `tcp and host ${localAddress} and not (${webPortFilter}) and len > 30`;
}

function toIsoOrNull(timestamp: number): string | null {
  return timestamp > 0 ? new Date(timestamp).toISOString() : null;
}

function summarizeConnections(connections: CaptureConnection[]): Array<Omit<CaptureConnection, "owningProcess">> {
  return connections.map((connection) => ({
    state: connection.state,
    localAddress: connection.localAddress,
    localPort: connection.localPort,
    remoteAddress: connection.remoteAddress,
    remotePort: connection.remotePort,
  }));
}

function connectionSignature(connections: CaptureConnection[]): string {
  return connections
    .map((connection) => `${connection.localAddress}->${connection.remoteAddress}:${connection.remotePort}`)
    .sort()
    .filter((value, index, values) => index === 0 || values[index - 1] !== value)
    .join("|");
}

function summarizeEvent(event: ParsedEvent): string {
  const json = JSON.stringify(event.value);
  return `Parsed ${event.name}: ${json}`;
}

function eventFingerprint(event: ParsedEvent): string {
  try {
    return `${event.name}:${JSON.stringify(event.value)}`;
  } catch {
    return `${event.name}:${String(event.value)}`;
  }
}

function looksLikeSpecialProtocol(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("x") || trimmed.includes("[INV]");
}

function shouldDebugPayload(payloadText: string, messages: MessageValue[], events: ParsedEvent[]): boolean {
  if (
    events.some(
      (event) =>
        event.name === EVENT_NAMES.item ||
        event.name === EVENT_NAMES.gold ||
        event.name === EVENT_NAMES.mail ||
        event.name === EVENT_NAMES.satanicZone,
    )
  ) {
    return true;
  }

  return (
    /\b(?:addeditem|rarity|gold|currency|gss|gsh|gns|gnh|gbp|mail)\b/i.test(payloadText) ||
    messages.some((message) => messageHasRoute(message, /^(?:mailbox|satanic_zone)\//i))
  );
}

function isOnlyItemEvents(events: ParsedEvent[]): boolean {
  return events.length > 0 && events.every((event) => event.name === EVENT_NAMES.item);
}

function messageKeySummary(value: MessageValue): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return Object.keys(value)
    .filter((key) => /^[\w-]{1,48}$/.test(key))
    .slice(0, 16)
    .join(",");
}

function sanitizeDebugSnippet(text: string): string {
  const normalized = text
    .replace(/\0/g, "")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, " ")
    .replace(/\s+/g, " ");

  return redactSensitiveDebugText(normalized).slice(0, MAX_DEBUG_SNIPPET);
}

function redactSensitiveDebugText(text: string): string {
  return text
    .replace(
      /\b(account_id|unique_account_id|crossregion_identifier|identifier|checksum|previous_ig_hash|previous_hash|game_state_hash)=([^&\s]+)/gi,
      "$1=<redacted>",
    )
    .replace(
      /"((?:account_id|unique_account_id|crossregion_identifier))"\s*:\s*\d+/gi,
      '"$1":"<redacted>"',
    )
    .replace(
      /"((?:identifier|checksum|previous_ig_hash|previous_hash|game_state_hash|newIdentifierHash|timestampPrevHash))"\s*:\s*"[^"]*"/gi,
      '"$1":"<redacted>"',
    );
}

function messageHasRoute(value: MessageValue, routePattern: RegExp): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const route = String((value as Record<string, unknown>).route ?? (value as Record<string, unknown>).__route ?? "");
  return routePattern.test(route);
}

function isLikelyParseablePayload(text: string): boolean {
  if (text.length === 0) return false;
  if (hasGameTextSignal(text)) return true;
  if (printableRatio(text) < 0.6) return false;
  return /(?:[a-zA-Z0-9_]+\/[a-zA-Z0-9_]+|[a-zA-Z0-9_]+=|\{["\w]|\[[{\w"])/.test(text) || looksLikeSpecialProtocol(text);
}

function hasGameTextSignal(text: string): boolean {
  return /\b(?:mailbox|satanic_zone|save|inventory|addedItem|currency|gold|rarity)\b/i.test(text);
}

function printableRatio(text: string): number {
  const sample = text.slice(0, 2048);
  if (!sample) return 0;
  let printable = 0;
  for (const char of sample) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126)) printable += 1;
  }
  return printable / sample.length;
}

function isUsefulEvent(event: ParsedEvent): boolean {
  return true;
}

function shouldLogEvent(event: ParsedEvent): boolean {
  if (event.name === EVENT_NAMES.accountMode) return false;
  if (event.name === EVENT_NAMES.item) return false;
  return isUsefulEvent(event);
}

function formatError(error: unknown): string {
  return error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
}

function rotateLogIfLarge(logPath: string, maxBytes: number): void {
  if (!fs.existsSync(logPath)) return;
  const stat = fs.statSync(logPath);
  if (stat.size <= maxBytes) return;

  const rotatedPath = `${logPath}.old`;
  if (fs.existsSync(rotatedPath)) fs.unlinkSync(rotatedPath);
  fs.renameSync(logPath, rotatedPath);
}
