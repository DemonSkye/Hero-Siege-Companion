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
const MAX_DEBUG_LOG_BYTES = 5 * 1024 * 1024;
const POLL_INTERVAL_MS = 1000;
const EVENT_DEDUP_WINDOW_MS = 2500;

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
  private activeSignature = "";
  private readonly packetBuffers = new PacketBuffers();
  private packetsSeen = 0;
  private payloadsAssembled = 0;
  private messagesDecoded = 0;
  private parsedEvents = 0;
  private lastGoldProbeAt = 0;
  private lastAntiCheatWaitLogAt = 0;
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
    this.pollTimer = setInterval(() => void this.refreshCapture(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.closeCapture();
    this.activeSignature = "";
    this.packetBuffers.clear();
    this.recentEventFingerprints.clear();
    this.emit({ running: false, status: "idle", health: { device: null, filter: "" }, log: { level: "info", message: "Capture stopped." } });
  }

  private async refreshCapture(networkState?: HeroSiegeNetworkState): Promise<void> {
    const currentNetworkState = networkState ?? (await getHeroSiegeNetworkState());
    const connections = currentNetworkState.connections;
    this.emit({ connections });

    if (currentNetworkState.antiCheatProcessIds.length > 0 && connections.length === 0) {
      this.closeCapture();
      this.activeSignature = "";
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

    const signature = connectionSignature(connections);
    if (!signature) {
      if (this.activeSignature !== "") this.emit({ log: { level: "warning", message: "Hero Siege connections disappeared." } });
      this.activeSignature = "";
      this.closeCapture();
      this.emit({ status: "waiting", health: { device: null, filter: "" } });
      return;
    }

    if (signature === this.activeSignature && this.cap) return;

    this.activeSignature = signature;
    this.openCapture(connections);
  }

  private openCapture(connections: CaptureConnection[]): void {
    const localAddresses = unique(connections.map((connection) => connection.localAddress));
    const remoteAddresses = unique(connections.map((connection) => connection.remoteAddress));
    const localAddress = localAddresses[0];

    if (!localAddress || remoteAddresses.length === 0) {
      this.emit({ status: "waiting", log: { level: "warning", message: "Waiting for usable Hero Siege remote connections." } });
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
      this.closeCapture();
      this.emit({
        status: "error",
        error: `Npcap cannot find the adapter for ${localAddress}.`,
        log: { level: "error", message: `Npcap adapter lookup failed for ${localAddress}. Devices: ${devices || "none"}` },
      });
      return;
    }

    const filter = `tcp and (${remoteAddresses.map((address) => `host ${address}`).join(" or ")}) and len > 30`;

    try {
      const nextCap = new Cap();
      const linkType = nextCap.open(device, filter, 10 * 1024 * 1024, this.buffer);
      nextCap.on("packet", (nbytes: number, truncated: boolean) => this.onPacket(nbytes, truncated));
      this.closeCapture();
      this.cap = nextCap;
      this.packetBuffers.clear();
      this.recentEventFingerprints.clear();
      this.emit({
        status: "running",
        health: { device, filter },
        log: { level: "success", message: `Capture opened on ${device} (${linkType}).` },
      });
    } catch (error) {
      this.closeCapture();
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
      this.emit({
        status: "running",
        log: { level: "error", message: `Packet processing failed but capture stayed alive: ${formatError(error)}` },
      });
    }
  }

  private processPacket(nbytes: number, truncated: boolean): void {
    if (truncated) this.emit({ log: { level: "warning", message: "Npcap truncated a packet." } });

    const parsedPacket = getPayload(this.buffer, nbytes);
    if (!parsedPacket) return;

    this.packetsSeen += 1;
    const completedPayloads = this.packetBuffers.push(parsedPacket);
    const events: ParsedEvent[] = [];

    for (const payloadText of completedPayloads) {
      if (!isLikelyParseablePayload(payloadText)) continue;

      this.payloadsAssembled += 1;
      const messages = captureMessages(payloadText);
      this.messagesDecoded += messages.length;
      const nextEvents = messageToEvents(messages);
      const usefulEvents = nextEvents.filter(isUsefulEvent).filter((event) => !this.isDuplicateEvent(event));
      events.push(...usefulEvents);
      this.probeDebugPayload(payloadText, messages, usefulEvents);
      this.probeGoldPayload(payloadText, usefulEvents);
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
    const sample = summarizeEvent(events[0]);
    this.emit({
      events,
      health: {
        packetsSeen: this.packetsSeen,
        payloadsAssembled: this.payloadsAssembled,
        messagesDecoded: this.messagesDecoded,
        parsedEvents: this.parsedEvents,
      },
      log: shouldLogEvent(events[0]) ? { level: "debug", message: sample } : undefined,
    });
  }

  private closeCapture(): void {
    if (!this.cap) return;
    try {
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

function connectionSignature(connections: CaptureConnection[]): string {
  return connections
    .map((connection) => `${connection.localAddress}->${connection.remoteAddress}`)
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
  if (events.some((event) => event.name === EVENT_NAMES.item || event.name === EVENT_NAMES.gold || event.name === EVENT_NAMES.mail)) return true;
  return (
    looksLikeSpecialProtocol(payloadText) ||
    /\b(?:addeditem|inventory|operation|rarity|gold|currency|gss|gsh|gns|gnh|gbp|mail)\b/i.test(payloadText) ||
    messages.some((message) => messageHasRoute(message, /^(?:mailbox|satanic_zone)\//i))
  );
}

function messageKeySummary(value: MessageValue): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return Object.keys(value)
    .filter((key) => /^[\w-]{1,48}$/.test(key))
    .slice(0, 16)
    .join(",");
}

function sanitizeDebugSnippet(text: string): string {
  return text
    .replace(/\0/g, "")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, MAX_DEBUG_SNIPPET);
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
  return event.name !== EVENT_NAMES.item || isUsefulEvent(event);
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
