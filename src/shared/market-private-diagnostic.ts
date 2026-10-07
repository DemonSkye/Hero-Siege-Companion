export interface MarketPrivateDiagnosticState {
  phase: "off" | "armed" | "recording" | "saved" | "failed";
  filePath?: string;
  completeResponse?: boolean;
}
