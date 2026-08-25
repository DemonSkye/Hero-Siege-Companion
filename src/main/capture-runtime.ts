import type { CaptureHealth, CapturePreferences, LogEntry } from "../shared/app-state";
import { captureMessages, messageToEvents, type ParsedEvent } from "../shared/parser";
import type { CaptureUpdate } from "./capture";
import { isElectronE2eTestMode } from "./electron-test-mode";

export type { CaptureUpdate };

export const NATIVE_CAPTURE_UNAVAILABLE_MESSAGE =
  "Capture unavailable: Npcap native capture support could not be loaded. Install or reinstall Npcap with WinPcap API-compatible mode enabled, then restart the app.";

export interface CaptureRuntime {
  diagnostics(): Promise<Partial<CaptureHealth>>;
  hasHeroSiegeProcess(): Promise<boolean>;
  setCapturePreferences(preferences: CapturePreferences): void;
  start(): Promise<void>;
  stop(): void;
}

export async function createCaptureRuntime(
  onUpdate: (update: CaptureUpdate) => void,
  debugLogPath: string,
  wideDebugLogPath: string,
  capturePreferences: CapturePreferences,
  supplementalCaptureProcessIds: () => readonly number[] = () => [],
): Promise<CaptureRuntime> {
  if (isElectronE2eTestMode()) return new ElectronE2eCaptureRuntime(onUpdate, capturePreferences);

  try {
    const { CaptureService } = await import("./capture");
    return new CaptureService(
      onUpdate,
      debugLogPath,
      wideDebugLogPath,
      capturePreferences,
      supplementalCaptureProcessIds,
    );
  } catch (error) {
    const runtime = new NativeCaptureUnavailableRuntime(onUpdate, error);
    runtime.emitUnavailable();
    return runtime;
  }
}

export function emitElectronE2eCaptureEvents(runtime: CaptureRuntime | null, events: ParsedEvent[]): boolean {
  if (!(runtime instanceof ElectronE2eCaptureRuntime)) return false;
  runtime.emitEvents(events);
  return true;
}

export function emitElectronE2eCapturePayloads(runtime: CaptureRuntime | null, payloads: string[]): boolean {
  if (!(runtime instanceof ElectronE2eCaptureRuntime)) return false;
  runtime.emitPayloads(payloads);
  return true;
}

class ElectronE2eCaptureRuntime implements CaptureRuntime {
  private running = false;
  private capturePreferences: CapturePreferences;
  private health: CaptureHealth = {
    npcapService: "Running",
    winPcapCompatible: true,
    adminOnly: false,
    device: "e2e-capture-device",
    filter: "e2e simulated Hero Siege traffic",
    packetsSeen: 0,
    payloadsAssembled: 0,
    messagesDecoded: 0,
    parsedEvents: 0,
    parserErrors: 0,
    parserRestarts: 0,
    lastParserError: null,
  };

  constructor(
    private readonly onUpdate: (update: CaptureUpdate) => void,
    capturePreferences: CapturePreferences,
  ) {
    this.capturePreferences = capturePreferences;
  }

  async diagnostics(): Promise<CaptureHealth> {
    return { ...this.health };
  }

  async hasHeroSiegeProcess(): Promise<boolean> {
    return process.env.HERO_SIEGE_COMPANION_E2E_GAME_RUNNING !== "0";
  }

  setCapturePreferences(preferences: CapturePreferences): void {
    this.capturePreferences = preferences;
  }

  async start(): Promise<void> {
    this.running = true;
    this.onUpdate({
      running: true,
      status: "running",
      error: null,
      health: { ...this.health },
      connections: [
        {
          owningProcess: 269210,
          state: "Established",
          localAddress: "127.0.0.1",
          localPort: 49210,
          remoteAddress: "203.0.113.42",
          remotePort: 26921,
        },
      ],
      log: { level: "info", message: "E2E capture runtime started." },
    });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.onUpdate({
      running: false,
      status: "idle",
      error: null,
      health: { ...this.health },
      connections: [],
      log: { level: "info", message: "E2E capture runtime stopped." },
    });
  }

  emitEvents(events: ParsedEvent[]): void {
    const eventCount = events.length;
    if (eventCount === 0) return;
    this.health = {
      ...this.health,
      packetsSeen: this.health.packetsSeen + eventCount,
      payloadsAssembled: this.health.payloadsAssembled + eventCount,
      messagesDecoded: this.health.messagesDecoded + eventCount,
      parsedEvents: this.health.parsedEvents + eventCount,
    };
    this.onUpdate({
      events,
      health: { ...this.health },
      logs: this.shouldEmitDebugLogs() ? [e2eLog("debug", `E2E emitted ${eventCount} parsed capture event${eventCount === 1 ? "" : "s"}.`)] : [],
    });
  }

  emitPayloads(payloads: string[]): void {
    const events: ParsedEvent[] = [];
    let messagesDecoded = 0;
    let parserErrors = 0;
    let lastParserError: string | null = null;

    for (const payload of payloads) {
      try {
        const messages = captureMessages(String(payload ?? ""));
        messagesDecoded += messages.length;
        events.push(...messageToEvents(messages));
      } catch (error) {
        parserErrors += 1;
        lastParserError = error instanceof Error ? error.message : String(error);
      }
    }

    this.health = {
      ...this.health,
      packetsSeen: this.health.packetsSeen + payloads.length,
      payloadsAssembled: this.health.payloadsAssembled + payloads.length,
      messagesDecoded: this.health.messagesDecoded + messagesDecoded,
      parsedEvents: this.health.parsedEvents + events.length,
      parserErrors: this.health.parserErrors + parserErrors,
      lastParserError: lastParserError ?? this.health.lastParserError,
    };

    const logs: LogEntry[] = [];
    if (this.shouldEmitDebugLogs()) {
      logs.push(e2eLog("debug", `E2E parsed ${payloads.length} mocked traffic payload${payloads.length === 1 ? "" : "s"}.`));
    }
    if (parserErrors > 0) logs.push(e2eLog("error", `E2E mocked traffic parser failed ${parserErrors} time${parserErrors === 1 ? "" : "s"}.`));

    this.onUpdate({
      events,
      health: { ...this.health },
      logs,
    });
  }

  private shouldEmitDebugLogs(): boolean {
    return this.capturePreferences.capturePayloadLogging || this.capturePreferences.captureWideLogging;
  }
}

function e2eLog(level: LogEntry["level"], message: string): LogEntry {
  return {
    id: `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    level,
    message,
    createdAt: Date.now(),
  };
}

class NativeCaptureUnavailableRuntime implements CaptureRuntime {
  constructor(
    private readonly onUpdate: (update: CaptureUpdate) => void,
    private readonly loadError: unknown,
  ) {}

  async diagnostics(): Promise<Partial<CaptureHealth>> {
    return {
      npcapService: "Unavailable",
      winPcapCompatible: false,
      adminOnly: false,
      device: null,
      filter: "",
    };
  }

  async hasHeroSiegeProcess(): Promise<boolean> {
    return false;
  }

  setCapturePreferences(): void {
    // Native capture never loaded, so there is no live capture logger to update.
  }

  async start(): Promise<void> {
    this.emitUnavailable();
  }

  stop(): void {
    this.onUpdate({
      running: false,
      status: "idle",
      error: null,
      health: { device: null, filter: "" },
      log: { level: "info", message: "Capture stopped." },
    });
  }

  emitUnavailable(): void {
    this.onUpdate({
      running: false,
      status: "error",
      error: NATIVE_CAPTURE_UNAVAILABLE_MESSAGE,
      connections: [],
      health: {
        npcapService: "Unavailable",
        winPcapCompatible: false,
        adminOnly: false,
        device: null,
        filter: "",
      },
      log: {
        level: "error",
        message: `${NATIVE_CAPTURE_UNAVAILABLE_MESSAGE} (${errorMessage(this.loadError)})`,
      },
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
