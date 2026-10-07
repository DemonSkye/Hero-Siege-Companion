/** Reconstructed public search/response shapes from 2026-09-04 retained findings,
 * build 24868792. All identity/session/seller values are invented canaries.
 * No captured authentication, endpoint or listing identity is retained. These
 * fixtures prove local construction/reduction, never server acceptance.
 */
export const marketSearchFixture = {
  itemMask: 1_073_746_020,
  minSockets: 4,
  statFilters: [{ statId: 64, minimum: 8 }],
};
export const marketContextFixture = {
  generation: 1, revision: 3, updatedAt: 1,
  endpoint: { address: "203.0.113.10", port: 6668 }, scopeKey: "invented-scope",
  fields: {
    account_id: "na-42", unique_account_id: "CANARY_IDENTITY",
    crossregion_identifier: "CANARY_SESSION", season: "11", hardcore: "0", beta: "0",
  },
};

export function installMemoryPreferencesStorage(): void {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    clear: () => values.clear(), getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key), setItem: (key: string, value: string) => values.set(key, value),
  } });
}
