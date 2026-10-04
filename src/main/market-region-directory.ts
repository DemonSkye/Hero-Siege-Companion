import { createHash } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";

const DIRECTORY_URL = "https://pn.panicartstudios.com/panicnet_api/herosiege_api_bootstrap.php";
const DIRECTORY_ROUTE = "login_serverlist_get";
const MAX_DIRECTORY_BYTES = 1_048_576;
const DIRECT_API_PORTS = [6668, 6669];
const DIRECTORY_CACHE_TTL_MS = 60 * 60_000;
const DIRECTORY_CACHE_STALE_LIMIT_MS = 6 * 60 * 60_000;
type Row = Record<string, unknown>;
export interface MarketRegionEndpoint { address: string; port: number; beta: string; region: string }

interface CachedDirectory {
  directory: MarketRegionDirectory;
  loadedAt: number;
}

/** Credential-free public metadata cache, deliberately separate from player session context. */
export class MarketRegionDirectoryCache {
  private cached: CachedDirectory | null = null;
  private inFlight: Promise<MarketRegionDirectory> | null = null;

  constructor(
    private readonly load: (signal: AbortSignal) => Promise<MarketRegionDirectory> = loadMarketRegionDirectory,
    private readonly now: () => number = Date.now,
  ) {}

  async get(signal: AbortSignal): Promise<MarketRegionDirectory> {
    const currentTime = this.now();
    if (this.cached && currentTime - this.cached.loadedAt <= DIRECTORY_CACHE_TTL_MS) return this.cached.directory;
    if (!this.inFlight) {
      const controller = new AbortController();
      this.inFlight = this.load(controller.signal).then((directory) => {
        this.cached = { directory, loadedAt: this.now() };
        return directory;
      }).catch((error) => {
        if (this.cached && this.now() - this.cached.loadedAt <= DIRECTORY_CACHE_STALE_LIMIT_MS) {
          return this.cached.directory;
        }
        throw error;
      }).finally(() => {
        this.inFlight = null;
      });
    }
    return await raceAbort(this.inFlight, signal);
  }
}

// Exact endpoint + mode, not IP geography or the unrelated gameplay-server ID.
export class MarketRegionDirectory {
  private readonly regions = new Map<string, string | null>();

  constructor(endpoints: readonly MarketRegionEndpoint[]) {
    for (const endpoint of endpoints) {
      const key = endpointKey(endpoint.address, endpoint.port, endpoint.beta);
      const previous = this.regions.get(key);
      this.regions.set(key, previous === undefined || previous === endpoint.region ? endpoint.region : null);
    }
  }

  lookup(address: string, port: number, beta: string | undefined): string | undefined {
    return beta === undefined ? undefined : this.regions.get(endpointKey(address, port, beta)) ?? undefined;
  }

  get endpointCount(): number {
    return [...this.regions.values()].filter((region) => region !== null).length;
  }
}

export function buildMarketRegionDirectoryBody(): string {
  return new URLSearchParams({
    api_script: DIRECTORY_ROUTE,
    passphrase: "YouShallPASs666",
    platform: "0",
    multipass: createHash("sha256").update("IoksbAf67bHlX10snbfB4be3x0z9" + DIRECTORY_ROUTE).digest("hex"),
  }).toString();
}

export async function loadMarketRegionDirectory(signal: AbortSignal): Promise<MarketRegionDirectory> {
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const response = await fetch(DIRECTORY_URL, {
    method: "POST", redirect: "error", signal: boundedSignal,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: buildMarketRegionDirectoryBody(),
  });
  if (!response.ok || !response.body) throw new Error("Directory unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DIRECTORY_BYTES) throw new Error("Directory too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const resolver = new Resolver({ timeout: 2_000, tries: 1 });
  const cancel = () => resolver.cancel();
  boundedSignal.addEventListener("abort", cancel, { once: true });
  try {
    boundedSignal.throwIfAborted();
    const directory = await parseMarketRegionDirectory(JSON.parse(Buffer.concat(chunks).toString("utf8")),
      (host) => resolver.resolve4(host));
    boundedSignal.throwIfAborted();
    return directory;
  } finally {
    boundedSignal.removeEventListener("abort", cancel);
    resolver.cancel();
  }
}

export async function parseMarketRegionDirectory(
  value: unknown,
  resolveAddresses: (hostname: string) => Promise<string[]>,
): Promise<MarketRegionDirectory> {
  const root = row(value);
  if (root?.status !== 1 || !Array.isArray(root.regionTable) || root.regionTable.length > 64) {
    throw new Error("Invalid region directory");
  }
  const endpoints: MarketRegionEndpoint[] = [];
  const regionIds = new Set<string>();
  const hosts = new Map<string, Promise<string[]>>();
  await Promise.all(root.regionTable.map(async (entry: unknown) => {
    const region = row(entry);
    if (!region || !validNumber(region.regionId, 999) || typeof region.regionAddress !== "string") return;
    let url: URL;
    try { url = new URL(region.regionAddress.trim()); } catch { return; }
    if (url.protocol !== "https:" || !url.hostname.endsWith(".panicartstudios.com")
      || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/herosiege_api/") return;
    const regionId = String(region.regionId);
    regionIds.add(regionId);
    if (!hosts.has(url.hostname)) hosts.set(url.hostname, resolveAddresses(url.hostname).catch(() => []));
    const addresses = await hosts.get(url.hostname)!;
    // The public region table describes production. Beta needs explicit tunnel metadata.
    for (const address of addresses.slice(0, 16).filter((item) => isIP(item) === 4)) {
      for (const port of DIRECT_API_PORTS) endpoints.push({ address, port, beta: "0", region: regionId });
    }
  }));
  const tunnels = row(root.proxyLists)?.apiTunnels;
  if (Array.isArray(tunnels) && tunnels.length <= 256) for (const entry of tunnels) {
    const tunnel = row(entry);
    if (!tunnel || !regionIds.has(String(tunnel.region_id)) || (tunnel.beta !== 0 && tunnel.beta !== 1)) continue;
    for (const [ipKey, portKey] of [["dest_ip", "dest_port"], ["tunnel_ip", "tunnel_port"]]) {
      const address = tunnel[ipKey];
      const port = tunnel[portKey];
      if (typeof address === "string" && isIP(address) === 4 && validNumber(port, 65535)) {
        endpoints.push({ address, port, beta: String(tunnel.beta), region: String(tunnel.region_id) });
      }
    }
  }
  const directory = new MarketRegionDirectory(endpoints);
  if (!directory.endpointCount) throw new Error("Directory has no usable API endpoints");
  return directory;
}

function row(value: unknown): Row | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined;
}
function validNumber(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= maximum;
}
function endpointKey(address: string, port: number, beta: string): string {
  return [address, port, beta].join("|");
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
