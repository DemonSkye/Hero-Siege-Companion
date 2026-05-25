import { execFile } from "node:child_process";
import type { CaptureConnection } from "../shared/app-state";

// Hero Siege gameplay traffic does not currently use HTTP/HTTPS ports.
// Exclude these transient launcher/CDN connections so they are not captured or logged.
const WEB_REMOTE_PORTS = new Set([80, 443]);

export interface HeroSiegeNetworkState {
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

export interface CaptureTarget {
  remoteAddress: string;
  remotePort: number;
}

export async function getHeroSiegeNetworkState(): Promise<HeroSiegeNetworkState> {
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
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const rawConnections = parsed.connections;
    const entries: PowerShellConnectionEntry[] = Array.isArray(rawConnections)
      ? rawConnections
      : rawConnections
        ? [rawConnections as PowerShellConnectionEntry]
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

export async function getNpcapServiceStatus(): Promise<string> {
  const output = await runPowerShell("Get-Service npcap -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status");
  return output || "Unknown";
}

export async function getNpcapRegistry(): Promise<{ adminOnly: boolean; winPcapCompatible: boolean }> {
  const output = await runPowerShell(
    "Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\WOW6432Node\\Npcap' -ErrorAction SilentlyContinue | Select-Object AdminOnly,WinPcapCompatible | ConvertTo-Json -Compress",
  );
  if (!output) return { adminOnly: false, winPcapCompatible: false };

  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    return {
      adminOnly: Number(parsed.AdminOnly) === 1,
      winPcapCompatible: Number(parsed.WinPcapCompatible) === 1,
    };
  } catch {
    return { adminOnly: false, winPcapCompatible: false };
  }
}

export function selectGameServerConnections(connections: CaptureConnection[]): CaptureConnection[] {
  return connections.filter((connection) => !isLikelyWebConnection(connection));
}

export function uniqueCaptureTargets(connections: CaptureConnection[]): CaptureTarget[] {
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

export function stableCaptureFilter(localAddress: string): string {
  const webPortFilter = Array.from(WEB_REMOTE_PORTS)
    .map((port) => `port ${port}`)
    .join(" or ");
  return `tcp and host ${localAddress} and not (${webPortFilter}) and len > 30`;
}

export function summarizeConnections(connections: CaptureConnection[]): Array<Omit<CaptureConnection, "owningProcess">> {
  return connections.map((connection) => ({
    state: connection.state,
    localAddress: connection.localAddress,
    localPort: connection.localPort,
    remoteAddress: connection.remoteAddress,
    remotePort: connection.remotePort,
  }));
}

export function connectionSignature(connections: CaptureConnection[]): string {
  return connections
    .map((connection) => `${connection.localAddress}->${connection.remoteAddress}:${connection.remotePort}`)
    .sort()
    .filter((value, index, values) => index === 0 || values[index - 1] !== value)
    .join("|");
}

function isLikelyWebConnection(connection: CaptureConnection): boolean {
  return WEB_REMOTE_PORTS.has(Number(connection.remotePort));
}

function normalizeNumberArray(value: unknown): number[] {
  const values = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return values.map(Number).filter(Number.isFinite);
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
