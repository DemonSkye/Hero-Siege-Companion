import type { CompanionState, LogEntry } from "../../src/shared/app-state";
import { PAST_RUN_SCHEMA_VERSION, createInitialStats, type ItemTimelineEntry, type PastRunSummary } from "../../src/shared/stats";
import type { ItemFilterGroup } from "../../src/renderer/src/lib/item-filters";

export const baseTime = new Date("2026-05-23T12:00:00.000Z").getTime();

export function companionState(overrides: Partial<CompanionState> = {}): CompanionState {
  const satanicZone = {
    rawZone: "Act_01_01",
    zone: "Act 1: Siege Fields",
    act: 1,
    area: 1,
    pros: [{ id: 1, name: "Treasure Goblin", description: "More loot." }],
    cons: [{ id: 2, name: "Lingering Evil", description: "More danger." }],
    buffs: [],
    updatedAt: baseTime,
  };
  return {
    captureRunning: true,
    captureStatus: "running",
    captureError: null,
    runStatus: "recording",
    runPausedReason: null,
    runPausedAt: null,
    runPausedDurationMs: 0,
    connections: [],
    health: {
      npcapService: "Running",
      winPcapCompatible: true,
      adminOnly: false,
      device: "\\Device\\NPF_Test",
      filter: "tcp and host 127.0.0.1",
      packetsSeen: 1250,
      payloadsAssembled: 64,
      messagesDecoded: 50,
      parsedEvents: 42,
      parserErrors: 0,
      parserRestarts: 0,
      lastParserError: null,
    },
    satanicZone: {
      current: satanicZone,
      phase: "current",
      source: "captured",
      lastAttemptAt: baseTime - 1_000,
      lastSuccessAt: baseTime,
      validUntil: baseTime + 30 * 60_000,
      nextAllowedRefreshAt: null,
      errorCode: null,
      refreshEnabled: false,
      refreshAvailable: false,
      refreshExperimental: false,
    },
    stats: {
      ...createInitialStats(),
      sessionStartedAt: baseTime - 600_000,
      accountName: "TestHero",
      seasonMode: "GSS",
      totalGold: 1_010_000,
      totalGoldEarned: 10_000,
      goldPerHour: 60_000,
      totalXp: 200_000,
      totalXpEarned: 5_000,
      xpPerHour: 30_000,
      totalKills: 150_000,
      totalKillsEarned: 25,
      killsPerHour: 150,
      hasMail: true,
      lastEventAt: baseTime - 30_000,
      items: {
        Set: { total: 1, mf: 0 },
        Satanic: { total: 2, mf: 1 },
        Heroic: { total: 3, mf: 2 },
        Angelic: { total: 0, mf: 0 },
      },
      itemsPerHour: {
        Set: 6,
        Satanic: 12,
        Heroic: 18,
        Angelic: 0,
      },
      itemBreakdown: {
        Set: { "Earth Shaper's Boots": { name: "Earth Shaper's Boots", total: 1, mf: 0 } },
        Satanic: { "Sash of the Magi": { name: "Sash of the Magi", total: 2, mf: 1 } },
        Heroic: { "Scourge Loop": { name: "Scourge Loop", total: 3, mf: 2 } },
        Angelic: {},
      },
      keys: {
        "Crystal Key": { id: 10, name: "Crystal Key", total: 2 },
      },
      ores: {
        "Copper Ore": { id: 27, name: "Copper Ore", total: 5 },
      },
      materials: {
        "Battle Fragment": { id: 0, name: "Battle Fragment", total: 3 },
      },
      itemTimeline: [
        itemTimelineEntry({ label: "Sash of the Magi", rarity: "Satanic", type: 6, id: 17, mfDrop: true, fingerprint: "drop-1" }),
        itemTimelineEntry({ label: "Copper Ore", rarity: "Common", type: 13, id: 27, amount: 3, fingerprint: "ore-1" }),
      ],
      satanicZone,
    },
    pastRuns: [],
    runArchivePreferences: {
      skipEmptyRuns: false,
      minDurationMinutes: 0,
    },
    capturePreferences: {
      captureDebugLogging: true,
      capturePayloadLogging: false,
      captureWideLogging: false,
      satanicZoneDebugLogging: true,
    },
    captureDiagnostics: {
      enhanced: { mode: "off", timedUntil: null },
      deep: { mode: "off", timedUntil: null },
    },
    logs: [logEntry({ id: "log-1", level: "success", message: "Capture opened." })],
    ...overrides,
  };
}

export function itemTimelineEntry(overrides: Partial<ItemTimelineEntry> = {}): ItemTimelineEntry {
  return {
    source: "inventory",
    repository: "unique",
    rarity: "Satanic",
    label: "Sash of the Magi",
    id: 17,
    type: 6,
    weaponType: 0,
    seed: 123,
    dropQuality: 0,
    amount: 1,
    mfDrop: false,
    fingerprint: "item-1",
    createdAt: baseTime,
    ...overrides,
  };
}

export function itemFilterGroup(overrides: Partial<ItemFilterGroup> = {}): ItemFilterGroup {
  return {
    id: "loot-alerts",
    name: "Loot Alerts",
    enabled: true,
    soundId: "crystal-tink",
    volume: 75,
    cooldownMs: 1200,
    rarities: ["Satanic"],
    types: [6],
    items: [{ name: "Sash of the Magi", soundId: "deep-gong", typeLabel: "Belt" }],
    ...overrides,
  };
}

export function pastRun(overrides: Partial<PastRunSummary> = {}): PastRunSummary {
  return {
    schemaVersion: PAST_RUN_SCHEMA_VERSION,
    id: "run-1",
    sessionStartedAt: baseTime - 600_000,
    sessionEndedAt: baseTime,
    durationMs: 600_000,
    accountName: "TestHero",
    tags: [],
    totalGoldGained: 100_000,
    totalXpGained: 50_000,
    totalKillsGained: 25,
    setDrops: 1,
    satanicDrops: 2,
    heroicDrops: 1,
    angelicDrops: 0,
    itemTotals: [
      { name: "Earth Shaper's Boots", total: 1, mf: 0 },
      { name: "Sash of the Magi", total: 2, mf: 1 },
      { name: "Scourge Loop", total: 1, mf: 1 },
      { name: "Crystal Key", total: 2, mf: 0 },
      { name: "Copper Ore", total: 5, mf: 0 },
      { name: "Battle Fragment", total: 3, mf: 0 },
    ],
    itemBreakdown: {
      Set: { "Earth Shaper's Boots": { name: "Earth Shaper's Boots", total: 1, mf: 0 } },
      Satanic: { "Sash of the Magi": { name: "Sash of the Magi", total: 2, mf: 1 } },
      Heroic: { "Scourge Loop": { name: "Scourge Loop", total: 1, mf: 1 } },
      Angelic: {},
    },
    keys: [{ id: 10, name: "Crystal Key", total: 2 }],
    ores: [{ id: 27, name: "Copper Ore", total: 5 }],
    materials: [{ id: 0, name: "Battle Fragment", total: 3 }],
    runPace: null,
    ...overrides,
  };
}

function logEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: "log",
    level: "info",
    message: "Test log",
    createdAt: baseTime,
    ...overrides,
  };
}
