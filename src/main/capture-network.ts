import { execFile } from "node:child_process";
import type { CaptureConnection } from "../shared/app-state";

// Exclude transient launcher/CDN connections from passive game capture.
const WEB_REMOTE_PORTS = new Set([80, 443]);
const CAPTURABLE_TCP_STATES = new Set(["3", "4", "5", "synsent", "synreceived", "established"]);

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

export interface RetainedCaptureTarget {
  target: CaptureTarget;
  expiresAt: number;
}

export interface CapturePacketEndpoints {
  src: string;
  srcPort: number;
  dst: string;
  dstPort: number;
}

export async function getHeroSiegeNetworkState(
  supplementalProcessIds: readonly number[] = [],
): Promise<HeroSiegeNetworkState> {
  const supplementalProcessIdLiteral = normalizeCaptureProcessIds(supplementalProcessIds).join(",");
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
    $captureProcessIds = @($processIds + @(${supplementalProcessIdLiteral}));
    $connections = @();

    if ($captureProcessIds.Count -gt 0) {
      $connections = @(
        Get-NetTCPConnection -ErrorAction SilentlyContinue |
          Where-Object {
            $captureProcessIds -contains $_.OwningProcess -and
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
  } catch (error) {
    throw new Error(`PowerShell network query returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Keeps process IDs safe to interpolate as numeric PowerShell literals. */
export function normalizeCaptureProcessIds(values: readonly number[]): number[] {
  return Array.from(new Set(values))
    .filter((value) => Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff)
    .sort((left, right) => left - right);
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
  return connections.filter((connection) => !isLikelyWebConnection(connection) && isCapturableConnectionState(connection.state));
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

export function refreshRetainedCaptureTargets(
  retainedTargets: Map<string, RetainedCaptureTarget>,
  connections: CaptureConnection[],
  now: number,
  graceMs: number,
): CaptureTarget[] {
  for (const target of uniqueCaptureTargets(connections)) {
    retainedTargets.set(captureTargetKey(target), { target, expiresAt: now + Math.max(graceMs, 0) });
  }
  for (const [key, retained] of retainedTargets.entries()) {
    if (retained.expiresAt <= now) retainedTargets.delete(key);
  }
  return Array.from(retainedTargets.values(), ({ target }) => target);
}

export function stableCaptureFilter(localAddress: string, targets: CaptureTarget[]): string {
  const targetFilters = uniqueTargets(targets)
    .sort((left, right) => `${left.remoteAddress}:${left.remotePort}`.localeCompare(`${right.remoteAddress}:${right.remotePort}`))
    .map((target) => `(host ${target.remoteAddress} and port ${target.remotePort})`);
  if (targetFilters.length === 0) return `tcp and host ${localAddress} and not (port 80 or port 443) and len > 30`;
  return `tcp and host ${localAddress} and (${targetFilters.join(" or ")}) and len > 30`;
}

export function captureConnectionFlowKey(connection: CaptureConnection): string {
  return `${connection.localAddress}:${connection.localPort}->${connection.remoteAddress}:${connection.remotePort}`;
}

export function capturePacketFlowKey(packet: CapturePacketEndpoints, localAddress: string): string | null {
  if (packet.src === localAddress) return `${packet.src}:${packet.srcPort}->${packet.dst}:${packet.dstPort}`;
  if (packet.dst === localAddress) return `${packet.dst}:${packet.dstPort}->${packet.src}:${packet.srcPort}`;
  return null;
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

function isCapturableConnectionState(state: CaptureConnection["state"]): boolean {
  return CAPTURABLE_TCP_STATES.has(String(state).replace(/[^a-z0-9]/gi, "").toLowerCase());
}

function uniqueTargets(targets: CaptureTarget[]): CaptureTarget[] {
  const seen = new Set<string>();
  const uniqueTargets: CaptureTarget[] = [];
  for (const target of targets) {
    const remotePort = Number(target.remotePort);
    const key = `${target.remoteAddress}:${remotePort}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueTargets.push({ remoteAddress: target.remoteAddress, remotePort });
  }
  return uniqueTargets;
}

function captureTargetKey(target: CaptureTarget): string {
  return `${target.remoteAddress}:${Number(target.remotePort)}`;
}

function normalizeNumberArray(value: unknown): number[] {
  const values = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return values.map(Number).filter(Number.isFinite);
}

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 15_000 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message;
          reject(new Error(`PowerShell network query failed: ${detail}`));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}
