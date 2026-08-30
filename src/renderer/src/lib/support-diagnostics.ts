import type { CompanionState } from "../../../shared/app-state";
import type { SupportDiagnosticsInfo } from "../../../shared/support-diagnostics";

export const DEFAULT_SUPPORT_DIAGNOSTICS_INFO: SupportDiagnosticsInfo = {
  userDataPath: "%APPDATA%\\Hero Siege Companion",
  logsPath: "%APPDATA%\\Hero Siege Companion\\logs",
  appVersion: "unknown",
  generatedFiles: [
    {
      name: "diagnostics-summary.txt",
      description: "Current capture status, adapter, filter, packet counters, parser health, and app version.",
    },
  ],
  logFiles: [],
};

export function createSupportDiagnosticsSummary(state: CompanionState, info: SupportDiagnosticsInfo): string {
  const health = state.health;
  return [
    "Hero Siege Companion capture diagnostics",
    `App version: ${info.appVersion || "unknown"}`,
    `Capture status: ${state.captureStatus}`,
    `Capture error: ${state.captureError || "none"}`,
    `Capture running: ${state.captureRunning ? "yes" : "no"}`,
    `Enhanced diagnostics: ${state.captureDiagnostics.enhanced.mode}`,
    `Deep diagnostics: ${state.captureDiagnostics.deep.mode}`,
    `Npcap service: ${health.npcapService || "Unknown"}`,
    `WinPcap compatible: ${health.winPcapCompatible ? "yes" : "no"}`,
    `Admin-only Npcap: ${health.adminOnly ? "yes" : "no"}`,
    `Adapter: ${health.device || "none"}`,
    `Filter: ${health.filter || "none"}`,
    `Packets seen: ${health.packetsSeen}`,
    `Payloads assembled: ${health.payloadsAssembled}`,
    `Messages decoded: ${health.messagesDecoded}`,
    `Parsed events: ${health.parsedEvents}`,
    `Parser errors: ${health.parserErrors}`,
    `Parser restarts: ${health.parserRestarts}`,
    `Last parser error: ${health.lastParserError || "none"}`,
  ].join("\n");
}
