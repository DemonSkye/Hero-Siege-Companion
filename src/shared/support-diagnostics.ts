export interface SupportDiagnosticGeneratedFileInfo {
  name: string;
  description: string;
}

export interface SupportDiagnosticLogFileInfo {
  name: string;
  path: string;
  description: string;
  exists: boolean;
  sizeBytes: number;
  updatedAt: string | null;
}

export interface SupportDiagnosticsInfo {
  userDataPath: string;
  generatedFiles: SupportDiagnosticGeneratedFileInfo[];
  logFiles: SupportDiagnosticLogFileInfo[];
}

export interface SupportDiagnosticsSaveResult {
  saved: boolean;
  canceled: boolean;
  filePath: string | null;
  includedFiles: string[];
}
