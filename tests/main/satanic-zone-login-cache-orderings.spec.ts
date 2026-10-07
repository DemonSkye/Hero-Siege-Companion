import { afterEach, describe, expect, test, vi } from "vitest";
import type { CaptureConnection } from "../../src/shared/app-state";
import type { HeroSiegeNetworkState } from "../../src/main/capture-network";
import { SatanicZoneLoginCache } from "../../src/main/satanic-zone-login-cache";
import type { SatanicZoneLoginCacheStore } from "../../src/main/satanic-zone-login-cache-store";
import { SatanicZoneDiagnosticBufferBudget } from "../../src/main/satanic-zone-diagnostic-budget";
import { inventedConnect, inventedPostLogin, inventedProbeScope, inventedProbeIdentity } from "../fixtures/satanic-zone-initialized";

// Production cache state machine; storage, ownership and all credentials are synthetic.
// No filesystem, encryption service, socket, capture or authenticated request is used.
const active: Array<{ cache: SatanicZoneLoginCache; budget: SatanicZoneDiagnosticBufferBudget }> = [];
afterEach(() => {
  for (const { cache, budget } of active.splice(0)) {
    cache.dispose();
    expect(budget.usedBytes).toBe(0);
  }
});

async function fixture(loaded = true) {
  const budget = new SatanicZoneDiagnosticBufferBudget();
  let unlocked = false;
  const store = {
    isUnlocked: () => unlocked,
    lock: () => { unlocked = false; },
    forgetUnlockingKey: () => true,
    forget: () => { unlocked = false; return true; },
    unlock: async () => {
      unlocked = true;
      // The generic canary account is not an admitted session-context account.
      // Substitute a numeric synthetic account in both byte-exact body shapes.
      const accountBody = (body: Buffer) => Buffer.from(body.toString("latin1").replace("CANARY_ACCOUNT", "424242"), "latin1");
      return { connectBody: budget.copy(accountBody(inventedConnect())), postLoginBody: budget.copy(accountBody(inventedPostLogin())) };
    },
  } as unknown as SatanicZoneLoginCacheStore;
  const identityFlow: CaptureConnection = { ...inventedProbeScope, localPort: 5000, owningProcess: 42, state: "established" };
  const accountFlow: CaptureConnection = { ...identityFlow, localPort: 6000 };
  const network: HeroSiegeNetworkState = { gameProcessIds: [42], antiCheatProcessIds: [], connections: [identityFlow, accountFlow] };
  const networkState = vi.fn(async () => network);
  const cache = new SatanicZoneLoginCache({ store, networkState, onChange: () => undefined });
  active.push({ cache, budget });
  cache.attachBudget(budget); cache.configure(true);
  if (loaded) expect(await cache.unlock("SYNTHETIC passphrase")).toBe(true);
  const identityPayload = { ...inventedProbeScope, localPort: identityFlow.localPort, direction: "outbound" as const,
    text: `unique_account_id=${inventedProbeIdentity.uniqueAccountId}&beta=0` };
  const accountPayload = { ...identityPayload, localPort: accountFlow.localPort, text: "account_id=424242" };
  const defer = () => {
    let release!: (snapshot: HeroSiegeNetworkState) => void;
    networkState.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    return (snapshot = network) => release(snapshot);
  };
  return { cache, network, networkState, identityFlow, accountFlow, identityPayload, accountPayload, defer };
}

describe("portable cache independent attribution orderings", () => {
  test.each([true, false].flatMap(loaded => ["missing", "closed unknown owner", "unknown owner", "duplicate", "contrary owner"].map(kind => ({ loaded, kind }))))(
    "$kind account-only topology during deferred identity binding rejects stale ownership (loaded=$loaded)", async ({ loaded, kind }) => {
      const f = await fixture(loaded);
      await f.cache.observe(f.accountPayload);
      const release = f.defer(), pending = f.cache.observe(f.identityPayload);
      let accountFlows: CaptureConnection[] = [{ ...f.accountFlow }];
      if (kind === "missing") accountFlows = [];
      if (kind === "closed unknown owner") accountFlows = [{ ...f.accountFlow, state: "closed", owningProcess: 0 }];
      if (kind === "unknown owner") accountFlows = [{ ...f.accountFlow, owningProcess: 0 }];
      if (kind === "duplicate") accountFlows.push({ ...f.accountFlow });
      if (kind === "contrary owner") accountFlows = [{ ...f.accountFlow, owningProcess: 43 }];
      f.cache.observeConnections([f.identityFlow, ...accountFlows]);
      release(); await pending;
      if (!loaded) expect(await f.cache.unlock("SYNTHETIC passphrase")).toBe(true);
      expect(f.cache.restoreInput() === null).toBe(true);
      expect(f.cache.snapshot().status).not.toBe("validated");
    },
  );

  test.each([true, false].flatMap(loaded => [1, 4, 2].map(flags => ({ loaded, flags }))))(
    "account-only lifecycle flags=$flags invalidate deferred identity binding (loaded=$loaded)", async ({ loaded, flags }) => {
    const f = await fixture(loaded);
    await f.cache.observe(f.accountPayload);
    const release = f.defer(), pending = f.cache.observe(f.identityPayload);
    f.cache.observeLifecycle({ src: f.accountFlow.localAddress, dst: f.accountFlow.remoteAddress,
      srcPort: f.accountFlow.localPort, dstPort: f.accountFlow.remotePort, flags });
    release(); await pending;
    if (!loaded) expect(await f.cache.unlock("SYNTHETIC passphrase")).toBe(true);
    expect(f.cache.restoreInput() === null).toBe(true);
    expect(f.cache.snapshot().status).not.toBe("validated");
  });

  test.each(["missing", "replacement"])("%s attributed account memo cannot bind during deferred unlock query", async kind => {
    const f = await fixture(false);
    await f.cache.observe(f.accountPayload); await f.cache.observe(f.identityPayload);
    const release = f.defer(), pending = f.cache.unlock("SYNTHETIC passphrase");
    await Promise.resolve();
    expect(f.networkState).toHaveBeenCalledTimes(2);
    f.cache.observeConnections([f.identityFlow, ...(kind === "replacement" ? [{ ...f.accountFlow, localPort: 7000 }] : [])]);
    release(); expect(await pending).toBe(true);
    expect(f.cache.restoreInput() === null).toBe(true);
    expect(f.cache.snapshot().status).not.toBe("validated");
  });

  test("account-only SYN-ACK is not termination and cannot manufacture readiness before the query", async () => {
    const f = await fixture();
    await f.cache.observe(f.accountPayload);
    const release = f.defer(), pending = f.cache.observe(f.identityPayload);
    f.cache.observeLifecycle({ src: f.accountFlow.localAddress, dst: f.accountFlow.remoteAddress,
      srcPort: f.accountFlow.localPort, dstPort: f.accountFlow.remotePort, flags: 18 });
    expect(f.cache.restoreInput() === null).toBe(true);
    release(); await pending;
    expect(f.cache.restoreInput()?.nativePort).toBe(f.identityFlow.localPort);
  });

  test("a current validated scope cannot hide a contradictory pending identity scope", async () => {
    const f = await fixture(); await f.cache.observe(f.identityPayload);
    expect(f.cache.restoreInput()?.nativePort).toBe(f.identityFlow.localPort);
    const release = f.defer(), pending = f.cache.observe({ ...f.identityPayload, localPort: f.accountFlow.localPort });
    f.cache.observeConnections([f.identityFlow]);
    release(); await pending;
    expect(f.cache.restoreInput()?.nativePort).not.toBe(f.accountFlow.localPort);
  });

  test("a current validated scope cannot hide termination of pending identity on another tuple", async () => {
    const f = await fixture(); await f.cache.observe(f.identityPayload);
    const release = f.defer(), pending = f.cache.observe({ ...f.identityPayload, localPort: f.accountFlow.localPort });
    f.cache.observeLifecycle({ src: f.accountFlow.remoteAddress, dst: f.accountFlow.localAddress,
      srcPort: f.accountFlow.remotePort, dstPort: f.accountFlow.localPort, flags: 4 });
    release(); await pending;
    expect(f.cache.restoreInput()?.nativePort).not.toBe(f.accountFlow.localPort);
  });

  test("missing topology preserves an already validated scope", async () => {
    const f = await fixture(); await f.cache.observe(f.identityPayload);
    const original = f.cache.restoreInput();
    f.cache.observeConnections([]);
    expect(f.cache.restoreInput()?.scope).toBe(original?.scope);
    expect(f.cache.snapshot().status).toBe("validated");
  });

  test("identical evidence on the validated tuple keeps missing topology semantics while its query is pending", async () => {
    const f = await fixture(); await f.cache.observe(f.identityPayload);
    const original = f.cache.restoreInput();
    const release = f.defer(), pending = f.cache.observe(f.identityPayload);
    f.cache.observeConnections([]);
    const retainedDuringQuery = f.cache.restoreInput();
    release(); await pending;
    expect(retainedDuringQuery?.scope).toBe(original?.scope);
    expect(f.cache.restoreInput()?.scope).toBe(original?.scope);
    expect(f.cache.snapshot().status).toBe("validated");
  });

  test.each(["contrary owner", "closed", "process gone"])("a repeated validated tuple cannot survive a query confirming %s", async kind => {
    const f = await fixture(); await f.cache.observe(f.identityPayload);
    const release = f.defer(), pending = f.cache.observe(f.identityPayload);
    f.cache.observeConnections([]);
    const snapshot = { ...f.network, gameProcessIds: [42, 43], connections: [{ ...f.identityFlow }] };
    if (kind === "contrary owner") snapshot.connections[0].owningProcess = 43;
    if (kind === "closed") snapshot.connections[0].state = "closed";
    if (kind === "process gone") snapshot.gameProcessIds = [43];
    release(snapshot);
    await pending;
    expect(f.cache.restoreInput() === null).toBe(true);
    expect(f.cache.snapshot().status).not.toBe("validated");
  });

  test("account rejection cannot retain earlier validation contradicted by the same query", async () => {
    const f = await fixture(); await f.cache.observe(f.identityPayload);
    const accountFlow = { ...f.accountFlow, localPort: 7000 };
    f.network.connections.push(accountFlow);
    await f.cache.observe({ ...f.accountPayload, localPort: accountFlow.localPort });
    const release = f.defer(), pending = f.cache.observe({ ...f.identityPayload, localPort: f.accountFlow.localPort });
    release({ ...f.network, gameProcessIds: [42, 43], connections: [
      { ...f.identityFlow, owningProcess: 43 }, f.accountFlow, { ...accountFlow, state: "closed" },
    ] });
    await pending;
    expect(f.cache.restoreInput() === null).toBe(true);
    expect(f.cache.snapshot().status).not.toBe("validated");
  });
});
