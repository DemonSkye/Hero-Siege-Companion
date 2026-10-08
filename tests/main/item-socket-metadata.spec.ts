import { expect, test, vi } from "vitest";
import { messageToEvents, type ParsedEvent } from "../../src/shared/parser";
import { StatsEngine } from "../../src/shared/stats";
import { RecentEventDeduplicator } from "../../src/main/capture-event-state";
import { eventDebugSummary, eventFingerprint, summarizeEvent } from "../../src/main/capture-events";
import { itemBaseStatDefinition } from "../../src/shared/item-base-stat-catalog";
import { projectMarketListingItem } from "../../src/main/market-listing-projection";
import listingFixture from "../fixtures/market-listing-items.json";

// Reconstructed packet shapes with invented socket contents, not captured items.
// Native positional keys are grounded; their contents/occupancy are not decoded.
const slotCases = [
  { name: "native structured/encoded entries", fields: { s1: { b: 123 }, s3: "INVENTED_ENCODED_SOCKET" } },
  { name: "native null/zero/empty entries", fields: { s1: null, s2: 0, s3: "" } },
  { name: "legacy null/zero/empty entries", fields: { socket_1: null, socket_2: 0, socket_3: "" } },
  { name: "legacy structured entries", fields: { socket_1: { b: 123 }, socket_3: { b: 456 } } },
  { name: "mixed positional/legacy aliases", fields: { s1: { b: 123 }, socket_1: null, socket1: { b: 456 } } },
] as const;

function parseItem(fields: object, fingerprint = "SOCKET-META-A-1", amount = 1) {
  const payload = { addedItemFingerprint: fingerprint,
    addedItemObject: { c: 1, b: 100, type: 1, a: 123, d: 1, o: amount, ...fields } };
  const events = messageToEvents(payload);
  expect(events).toHaveLength(1);
  expect(events[0].name).toBe("itemAdded");
  return { payload, event: events[0] };
}

test.each(slotCases)("$name do not report socket capacity or discard raw fields", ({ fields }) => {
  const { payload, event } = parseItem(fields);
  expect(event.value).not.toHaveProperty("sockets");
  expect(event.value).not.toHaveProperty("socketCapacity");
  expect(event.raw).toEqual(payload);
  expect(eventDebugSummary(event).value).not.toHaveProperty("sockets");
  expect(summarizeEvent(event)).not.toContain('"sockets":');
  expect(new StatsEngine().applyEvents([event]).itemTimeline[0]).not.toHaveProperty("sockets");
});

test("socket-only representations keep deduplication while distinct item identity and amounts remain distinct", () => {
  const first = parseItem({}).event;
  const variants = slotCases.map(({ fields }) => parseItem(fields).event);
  const deduplicator = new RecentEventDeduplicator(100);
  expect(deduplicator.isDuplicate(first, 1000)).toBe(false);
  for (const [index, event] of variants.entries()) {
    expect(eventFingerprint(event)).toBe(eventFingerprint(first));
    expect(deduplicator.isDuplicate(event, 1010 + index)).toBe(true);
  }
  expect(deduplicator.isDuplicate(first, 1101)).toBe(false);
  const differentItem = parseItem({}, "SOCKET-META-B-1").event;
  expect(deduplicator.isDuplicate(differentItem, 1102)).toBe(false);
  expect(deduplicator.isDuplicate(parseItem({}, "SOCKET-META-A-1", 2).event, 1103)).toBe(false);
  const stats = new StatsEngine().applyEvents([first, ...variants, differentItem]);
  expect(stats.itemTimeline).toHaveLength(2);
});

test("legacy parsed metadata and current packets produce the same archive without a schema migration", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const event = parseItem({ s1: { b: 123 } }).event;
    const legacyEvent: ParsedEvent = { ...event, value: { ...event.value, sockets: 6 } };
    const modern = new StatsEngine(), legacy = new StatsEngine();
    modern.applyEvents([event]); legacy.applyEvents([legacyEvent]);
    const summary = modern.runSummary(Date.now() + 1000);
    expect(summary).toEqual(legacy.runSummary(Date.now() + 1000));
    expect(summary.schemaVersion).toBe(3);
    expect(summary.itemTotals).toEqual([{ name: "Sharpshooter's Cloak", total: 1, mf: 0 }]);
    const persisted = JSON.parse(JSON.stringify(summary));
    expect(persisted).toEqual(summary);
    expect(JSON.stringify(persisted)).not.toMatch(/"sockets"|"socketCapacity"/);
    // Old synthetic/replayed events can still carry the extra field; identity
    // deduplication prevents a second drop when old/new events are mixed.
    expect(modern.applyEvents([legacyEvent]).itemTimeline).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});

test("independent catalog and verified listing capacity remain separate from raw slot metadata", () => {
  const sockets = itemBaseStatDefinition("unique:1:0:100")?.stats.find(stat => stat.statId === 20);
  expect(sockets).toMatchObject({ kind: "range", minimum: 2, maximum: 4 });
  // Literal observed Bob's Plywood capacity; the tooltip oracle is independent
  // of the reconstruction implementation, whose seed remains in the fixture.
  const { row } = listingFixture.specimens[0];
  expect(projectMarketListingItem(row.item_data, row.fingerprint)?.stats?.find(stat => stat.statId === 20)?.value).toBe(4);
  expect(projectMarketListingItem({ ...row.item_data, s1: { b: 123 } }, row.fingerprint)).toEqual({
    itemKey: "unique:6:0:38", identified: true, statsReason: "unsupported-variant",
  });
});
