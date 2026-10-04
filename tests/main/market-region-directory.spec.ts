// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildMarketRegionDirectoryBody, loadMarketRegionDirectory, MarketRegionDirectory,
  MarketRegionDirectoryCache, parseMarketRegionDirectory,
} from "../../src/main/market-region-directory";

const regionTable = [
  { regionId: 10, regionAddress: "https://test10.panicartstudios.com/herosiege_api/\n" },
  { regionId: 2, regionAddress: "https://test2.panicartstudios.com/herosiege_api/" },
];
const apiTunnels = [
  { region_id: 10, dest_ip: "203.0.113.10", dest_port: 6668, tunnel_ip: "192.0.2.1", tunnel_port: 20010, beta: 0 },
  { region_id: 2, dest_ip: "203.0.113.2", dest_port: 6668, tunnel_ip: "192.0.2.1", tunnel_port: 20002, beta: 0 },
];
const payload = { status: 1, regionTable, proxyLists: { apiTunnels } };
const dns = async (host: string) => host.startsWith("test10.") ? ["203.0.113.10"] : ["203.0.113.2"];
afterEach(() => vi.unstubAllGlobals());

describe("public login-region directory", () => {
  test("maps both observed direct API ports and exact tunnel tuples, not world servers or another mode", async () => {
    const directory = await parseMarketRegionDirectory(payload, dns);
    expect(directory.lookup("203.0.113.10", 6669, "0")).toBe("10");
    expect(directory.lookup("203.0.113.10", 6668, "0")).toBe("10");
    expect(directory.lookup("192.0.2.1", 20010, "0")).toBe("10");
    expect(directory.lookup("192.0.2.1", 20002, "0")).toBe("2");
    expect(directory.lookup("203.0.113.10", 6600, "0")).toBeUndefined();
    expect(directory.lookup("203.0.113.10", 6669, "1")).toBeUndefined();
    expect(directory.lookup("203.0.113.10", 6669, undefined)).toBeUndefined();
    expect(directory.lookup("192.0.2.1", 20003, "0")).toBeUndefined();
  });

  test("fails closed on shared direct IPs while retaining unambiguous tunnel ports", async () => {
    const directory = await parseMarketRegionDirectory(payload, async () => ["203.0.113.10"]);
    expect(directory.lookup("203.0.113.10", 6669, "0")).toBeUndefined();
    expect(directory.lookup("203.0.113.10", 6668, "0")).toBeUndefined();
    expect(directory.lookup("192.0.2.1", 20010, "0")).toBe("10");
  });

  test("keeps explicit tunnel mappings when DNS fails and requires explicit beta metadata", async () => {
    const directory = await parseMarketRegionDirectory({
      ...payload, proxyLists: { apiTunnels: [...apiTunnels, { ...apiTunnels[0], tunnel_port: 21010, beta: 1 }] },
    }, async () => { throw new Error("DNS unavailable"); });
    expect(directory.lookup("192.0.2.1", 20010, "0")).toBe("10");
    expect(directory.lookup("192.0.2.1", 21010, "1")).toBe("10");
    expect(directory.lookup("203.0.113.10", 6669, "0")).toBeUndefined();
  });

  test("rejects unrelated hosts, credentials, routes and unregistered tunnel regions before DNS", async () => {
    const resolve = vi.fn(dns);
    const directory = await parseMarketRegionDirectory({
      status: 1,
      regionTable: [...regionTable,
        ...["https://evil.test/herosiege_api/", "http://test.panicartstudios.com/herosiege_api/",
          "https://user:pass@test.panicartstudios.com/herosiege_api/", "https://test.panicartstudios.com/wrong/",
          "https://test.panicartstudios.com.evil.test/herosiege_api/"].map((regionAddress, index) => ({
          regionId: index + 20, regionAddress,
        }))],
      proxyLists: { apiTunnels: [{ ...apiTunnels[0], region_id: 999 }] },
    }, resolve);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(directory.lookup("192.0.2.1", 20010, "0")).toBeUndefined();
  });

  test.each([null, { status: 0, regionTable }, { status: 1, regionTable: [] },
    { status: 1, regionTable: Array(65).fill(regionTable[0]) }])("rejects unusable directories", async (value) => {
    await expect(parseMarketRegionDirectory(value, dns)).rejects.toThrow();
  });

  test("constructs only the public-directory operation with no player or session fields", () => {
    const body = new URLSearchParams(buildMarketRegionDirectoryBody());
    expect([...body.keys()].sort()).toEqual(["api_script", "multipass", "passphrase", "platform"]);
    expect(body.get("api_script")).toBe("login_serverlist_get");
    expect(body.get("multipass")).toBe(createHash("sha256")
      .update("IoksbAf67bHlX10snbfB4be3x0z9login_serverlist_get").digest("hex"));
  });

  test("uses fixed HTTPS, disallows redirects and does not retry an HTTP failure", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadMarketRegionDirectory(new AbortController().signal)).rejects.toThrow("Directory unavailable");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "https://pn.panicartstudios.com/panicnet_api/herosiege_api_bootstrap.php",
      expect.objectContaining({ method: "POST", redirect: "error", signal: expect.any(AbortSignal) }),
    );
  });

  test("bounds the public response before parsing it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(1_048_577))));
    await expect(loadMarketRegionDirectory(new AbortController().signal)).rejects.toThrow("Directory too large");
  });

  test("coalesces public metadata loads, refreshes after TTL, and recovers with bounded stale data", async () => {
    let now = 1_000;
    const first = new MarketRegionDirectory([{ address: "203.0.113.10", port: 6668, beta: "0", region: "10" }]);
    const load = vi.fn(async () => first);
    const cache = new MarketRegionDirectoryCache(load, () => now);
    const signal = new AbortController().signal;
    const [left, right] = await Promise.all([cache.get(signal), cache.get(signal)]);
    expect(left).toBe(first);
    expect(right).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);

    now += 60 * 60_000 + 1;
    load.mockRejectedValueOnce(new Error("offline"));
    await expect(cache.get(signal)).resolves.toBe(first);
    now += 6 * 60 * 60_000 + 1;
    load.mockRejectedValueOnce(new Error("still offline"));
    await expect(cache.get(signal)).rejects.toThrow("still offline");
  });
});
