import { expect, test } from "vitest";
import { normalizeMarketFilterCriteria, normalizeMarketSearchRequest } from "../../src/shared/market-search";

test.each([
  [{}, {}], [{ minSockets: 2 }, { minSockets: 2 }], [{ maxSockets: 4 }, { maxSockets: 4 }],
  [{ minSockets: 2, maxSockets: 4 }, { minSockets: 2, maxSockets: 4 }],
  [{ minSockets: 0, maxSockets: 0 }, { minSockets: 0, maxSockets: 0 }],
  [{ minSockets: 6, maxSockets: 6 }, { minSockets: 6, maxSockets: 6 }],
] as const)("preserves native optional socket bounds %j without conflating zero with Any", (input, expected) => {
  expect(normalizeMarketFilterCriteria({ ...input, statFilters: [] })).toEqual({ ok: true, criteria: { ...expected, statFilters: [] } });
  expect(normalizeMarketSearchRequest({ itemMask: 1073746020, ...input, statFilters: [] })).toEqual({ ok: true, request: { itemMask: 1073746020, ...expected, statFilters: [] } });
});

test.each([
  [{ minSockets: -1 }, "invalid-min-sockets"], [{ minSockets: 7 }, "invalid-min-sockets"],
  [{ maxSockets: -1 }, "invalid-max-sockets"], [{ maxSockets: 7 }, "invalid-max-sockets"],
  [{ maxSockets: 1.5 }, "invalid-max-sockets"], [{ maxSockets: "4" }, "invalid-max-sockets"],
  [{ maxSockets: null }, "invalid-max-sockets"], [{ maxSockets: Infinity }, "invalid-max-sockets"],
  [{ minSockets: 5, maxSockets: 4 }, "invalid-socket-range"],
] as const)("rejects invalid socket range %j at the shared wire boundary", (input, reason) => {
  expect(normalizeMarketSearchRequest({ runewordId: 81, ...input, statFilters: [] })).toEqual({ ok: false, reason });
});
