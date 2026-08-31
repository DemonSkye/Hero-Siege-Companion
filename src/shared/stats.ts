import { EVENT_NAMES } from "./constants";
import type { AccountInfo, AddedItemObject, CurrencyData, ParsedEvent, SatanicZoneInfo } from "./parser";
import {
  canonicalRunPaceItemKey,
  createRunPaceRecorder,
  type PastRunPace,
  type RunPaceRecorder,
} from "./run-pace";
import { nextSatanicZoneBoundary } from "./satanic-zone";

export interface ItemCounter {
  total: number;
  mf: number;
}

export interface ItemDropCounter {
  name: string;
  total: number;
  mf: number;
}

export interface ResourceCounter {
  id: number;
  name: string;
  total: number;
}

export interface ItemTimelineEntry {
  source: AddedItemObject["source"];
  repository: AddedItemObject["repository"];
  rarity: string;
  label: string;
  localizationId?: string;
  id: number;
  type: number;
  weaponType: number;
  seed: number;
  dropQuality: number;
  amount: number;
  mfDrop: boolean;
  fingerprint?: string;
  createdAt: number;
}

export interface CompanionStats {
  sessionStartedAt: number;
  hasMail: boolean;
  seasonMode: string | null;
  accountName: string;
  totalGold: number;
  totalGoldEarned: number;
  goldPerHour: number;
  totalXp: number;
  totalXpEarned: number;
  xpPerHour: number;
  totalKills: number;
  totalKillsEarned: number;
  killsPerHour: number;
  items: Record<string, ItemCounter>;
  itemsPerHour: Record<string, number>;
  itemBreakdown: Record<string, Record<string, ItemDropCounter>>;
  keys: Record<string, ResourceCounter>;
  ores: Record<string, ResourceCounter>;
  materials: Record<string, ResourceCounter>;
  itemTimeline: ItemTimelineEntry[];
  satanicZone: SatanicZoneInfo | null;
  lastEventAt: number | null;
}

export interface PastRunSummary {
  schemaVersion: number;
  id: string;
  sessionStartedAt: number;
  sessionEndedAt: number;
  durationMs: number;
  accountName: string;
  tags: string[];
  totalGoldGained: number;
  totalXpGained: number;
  totalKillsGained: number;
  setDrops: number;
  satanicDrops: number;
  heroicDrops: number;
  angelicDrops: number;
  itemTotals: ItemDropCounter[];
  itemBreakdown: Record<string, Record<string, ItemDropCounter>>;
  keys: ResourceCounter[];
  ores: ResourceCounter[];
  materials: ResourceCounter[];
  runPace: PastRunPace | null;
}

const TRACKED_RARITIES = ["Set", "Satanic", "Heroic", "Angelic"];
const UNTRACKED_ITEM_TYPES = new Set([12, 13, 14, 15]);
const MAX_ITEM_TIMELINE_ENTRIES = 500;
export const PAST_RUN_SCHEMA_VERSION = 3;
export const MAX_PAST_RUN_ITEM_TOTALS = 2_048;
export const MAX_PAST_RUN_ITEM_NAME_LENGTH = 120;
export const MAX_PAST_RUN_TAGS = 12;
export const MAX_PAST_RUN_TAG_LENGTH = 36;
const BASIC_KEY_ID = 0;

const ORE_MATERIALS: Record<number, string> = {
  27: "Copper Ore",
  28: "Iron Ore",
  29: "Gold Ore",
  30: "Ruby",
  31: "Jade",
  32: "Tarethium Ore",
};

export class StatsEngine {
  private stats: CompanionStats = createInitialStats();
  private runPace: RunPaceRecorder = createRunPaceRecorder();
  private seenItemFingerprints = new Set<string>();
  private itemTotals = new Map<string, ItemDropCounter>();
  private lastCurrencyData: CurrencyData | null = null;
  private goldMode: string | null = null;
  private pausedAt: number | null = null;
  private totalPausedMs = 0;

  reset(): CompanionStats {
    this.stats = createInitialStats();
    this.runPace = createRunPaceRecorder();
    this.seenItemFingerprints.clear();
    this.itemTotals.clear();
    this.lastCurrencyData = null;
    this.goldMode = null;
    this.pausedAt = null;
    this.totalPausedMs = 0;
    return this.snapshot();
  }

  pause(timestamp = Date.now()): void {
    if (this.pausedAt !== null) return;
    this.pausedAt = timestamp;
  }

  resume(timestamp = Date.now()): void {
    if (this.pausedAt === null) return;
    this.totalPausedMs += Math.max(timestamp - this.pausedAt, 0);
    this.pausedAt = null;
  }

  applyEvents(events: ParsedEvent[]): CompanionStats {
    for (const event of events) this.applyEvent(event);
    this.recalculateRates();
    return this.snapshot();
  }

  snapshot(): CompanionStats {
    return structuredCloneCompat(this.stats);
  }

  runSummary(sessionEndedAt = Date.now()): PastRunSummary {
    const snapshot = this.snapshot();
    const pausedDurationMs = this.pausedDurationMs(sessionEndedAt);
    const itemTotals = itemTotalList(this.itemTotals);
    const durationMs = Math.max(sessionEndedAt - snapshot.sessionStartedAt - pausedDurationMs, 0);
    return createRunSummary(
      snapshot,
      sessionEndedAt,
      pausedDurationMs,
      itemTotals,
      this.runPace.snapshot({
        elapsedMs: durationMs,
        xp: snapshot.totalXpEarned,
        gold: snapshot.totalGoldEarned,
        kills: snapshot.totalKillsEarned,
        itemTotals,
      }),
    );
  }

  pausedDurationMs(timestamp = Date.now()): number {
    return this.totalPausedMs + (this.pausedAt === null ? 0 : Math.max(timestamp - this.pausedAt, 0));
  }

  private applyEvent(event: ParsedEvent): void {
    this.stats.lastEventAt = event.createdAt;
    let runPaceItem: { name: string; amount: number } | undefined;

    if (event.name === EVENT_NAMES.account || event.name === EVENT_NAMES.accountMode) {
      const account = event.value as AccountInfo;
      if (event.name === EVENT_NAMES.account) this.stats.accountName = account.name || this.stats.accountName;
      this.stats.seasonMode = account.seasonMode;
      if (event.name === EVENT_NAMES.account) {
        if (account.hasExperience !== false) this.updateXpTotal(account.experience);
        this.updateKillTotal(account.totalMonsterKills);
      }
      if (this.lastCurrencyData) this.updateGold(this.lastCurrencyData);
    } else if (event.name === EVENT_NAMES.gold) {
      this.updateGold(event.value as CurrencyData);
    } else if (event.name === EVENT_NAMES.xp) {
      const xp = Number(event.value) || 0;
      this.stats.totalXp += Math.trunc(xp / 0.15);
      this.stats.totalXpEarned += Math.trunc(xp / 0.15);
    } else if (event.name === EVENT_NAMES.mail) {
      this.stats.hasMail = Boolean(event.value);
    } else if (event.name === EVENT_NAMES.item || event.name === EVENT_NAMES.itemDrop) {
      const item = event.value as AddedItemObject;
      if (this.updateItem(item, event.createdAt)) {
        runPaceItem = { name: item.label, amount: Math.max(item.amount || 1, 1) };
      }
    } else if (event.name === EVENT_NAMES.satanicZone) {
      this.updateSatanicZone(event.value as SatanicZoneInfo);
    }

    this.runPace.record({
      elapsedMs: Math.max(event.createdAt - this.stats.sessionStartedAt - this.pausedDurationMs(event.createdAt), 0),
      xp: this.stats.totalXpEarned,
      gold: this.stats.totalGoldEarned,
      kills: this.stats.totalKillsEarned,
      item: runPaceItem,
    });
  }

  private updateGold(currency: CurrencyData): void {
    this.lastCurrencyData = currency;

    const mode = this.stats.seasonMode;
    if (mode) {
      const currentGold = currency[mode as keyof CurrencyData];
      if (typeof currentGold === "number") {
        if (this.stats.totalGold !== 0 && this.goldMode === mode) {
          const diff = currentGold - this.stats.totalGold;
          if (diff > 0) this.stats.totalGoldEarned += diff;
        }
        this.stats.totalGold = currentGold;
        this.goldMode = mode;
        return;
      }
    }

    if (currency.delta && currency.delta > 0) {
      this.stats.totalGoldEarned += currency.delta;
      if (this.stats.totalGold !== 0) this.stats.totalGold += currency.delta;
    }
  }

  private updateXpTotal(totalXp: number): void {
    if (this.stats.totalXp !== 0) {
      const diff = totalXp - this.stats.totalXp;
      if (diff > 0) this.stats.totalXpEarned += diff;
    }
    this.stats.totalXp = totalXp;
  }

  private updateKillTotal(totalKills: number): void {
    if (totalKills <= 0) return;
    if (this.stats.totalKills !== 0) {
      const diff = totalKills - this.stats.totalKills;
      if (diff > 0) this.stats.totalKillsEarned += diff;
    }
    this.stats.totalKills = totalKills;
  }

  private updateItem(item: AddedItemObject, createdAt: number): boolean {
    const rarity = item.rarityName;
    const trackedRarity = UNTRACKED_ITEM_TYPES.has(item.type) ? null : normalizeTrackedRarity(rarity);
    const itemAmount = Math.max(item.amount || 1, 1);
    if (item.fingerprint) {
      if (this.seenItemFingerprints.has(item.fingerprint)) return false;
      this.seenItemFingerprints.add(item.fingerprint);
    }

    const oreName = item.type === 14 ? ORE_MATERIALS[item.id] : undefined;
    incrementItemTotal(this.itemTotals, item.label, itemAmount, item.mfDrop === 1);

    if (trackedRarity) {
      this.stats.items[trackedRarity].total += itemAmount;
      if (item.mfDrop === 1) this.stats.items[trackedRarity].mf += itemAmount;
      incrementItemBreakdown(this.stats.itemBreakdown[trackedRarity], item.label, itemAmount, item.mfDrop === 1);
    }

    if (item.type === 12 && item.id !== BASIC_KEY_ID) {
      incrementResource(this.stats.keys, item.id, item.label, item.amount);
    }

    if (oreName) {
      incrementResource(this.stats.ores, item.id, oreName, itemAmount);
    } else if (item.type === 13 || item.type === 14) {
      incrementResource(this.stats.materials, item.id, item.label, itemAmount);
    }

    this.stats.itemTimeline.unshift({
      source: item.source,
      repository: item.repository,
      rarity,
      label: item.label,
      localizationId: item.localizationId,
      id: item.id,
      type: item.type,
      weaponType: item.weaponType,
      seed: item.seed,
      dropQuality: item.dropQuality,
      amount: item.amount,
      mfDrop: item.mfDrop === 1,
      fingerprint: item.fingerprint,
      createdAt,
    });
    this.stats.itemTimeline = this.stats.itemTimeline.slice(0, MAX_ITEM_TIMELINE_ENTRIES);
    return true;
  }

  private updateSatanicZone(zone: SatanicZoneInfo): void {
    const hasSpecificZone = typeof zone.act === "number" && typeof zone.area === "number" && zone.rawZone.length > 0;
    const cachedZoneExpired =
      this.stats.satanicZone !== null && Date.now() >= nextSatanicZoneBoundary(this.stats.satanicZone.updatedAt);

    if (hasSpecificZone) {
      this.stats.satanicZone = zone;
      return;
    }

    if (!this.stats.satanicZone || cachedZoneExpired) {
      this.stats.satanicZone = zone;
    }
  }

  private recalculateRates(): void {
    const now = Date.now();
    const hours = Math.max((now - this.stats.sessionStartedAt - this.pausedDurationMs(now)) / 3_600_000, 1 / 3600);
    this.stats.goldPerHour = Math.trunc(this.stats.totalGoldEarned / hours);
    this.stats.xpPerHour = Math.trunc(this.stats.totalXpEarned / hours);
    this.stats.killsPerHour = Math.trunc(this.stats.totalKillsEarned / hours);

    for (const rarity of TRACKED_RARITIES) {
      this.stats.itemsPerHour[rarity] = Math.trunc(this.stats.items[rarity].total / hours);
    }
  }
}

function normalizeTrackedRarity(rarity: string): string | null {
  const normalized = rarity.toLowerCase().trim();
  const matched = TRACKED_RARITIES.find((trackedRarity) => trackedRarity.toLowerCase() === normalized);
  if (matched) return matched;
  if (normalized.includes("angelic")) return "Angelic";
  if (normalized.includes("set")) return "Set";
  if (normalized.includes("heroic")) return "Heroic";
  if (normalized.includes("satanic")) return "Satanic";
  return null;
}

export function createInitialStats(): CompanionStats {
  const items: Record<string, ItemCounter> = {};
  const itemsPerHour: Record<string, number> = {};
  const itemBreakdown: Record<string, Record<string, ItemDropCounter>> = {};
  const ores: Record<string, ResourceCounter> = {};
  for (const rarity of TRACKED_RARITIES) {
    items[rarity] = { total: 0, mf: 0 };
    itemsPerHour[rarity] = 0;
    itemBreakdown[rarity] = {};
  }
  for (const [id, name] of Object.entries(ORE_MATERIALS)) {
    ores[name] = { id: Number(id), name, total: 0 };
  }

  return {
    sessionStartedAt: Date.now(),
    hasMail: false,
    seasonMode: null,
    accountName: "",
    totalGold: 0,
    totalGoldEarned: 0,
    goldPerHour: 0,
    totalXp: 0,
    totalXpEarned: 0,
    xpPerHour: 0,
    totalKills: 0,
    totalKillsEarned: 0,
    killsPerHour: 0,
    items,
    itemsPerHour,
    itemBreakdown,
    keys: {},
    ores,
    materials: {},
    itemTimeline: [],
    satanicZone: null,
    lastEventAt: null,
  };
}

export function normalizePastRunTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const normalizedTags: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const normalized = String(tag ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_PAST_RUN_TAG_LENGTH);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    normalizedTags.push(normalized);
    if (normalizedTags.length >= MAX_PAST_RUN_TAGS) break;
  }
  return normalizedTags;
}

export function normalizePastRunItemName(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PAST_RUN_ITEM_NAME_LENGTH)
    .trim() || "Unknown item";
}

export function pastRunItemNameKey(value: unknown): string {
  return canonicalRunPaceItemKey(value);
}

export function canonicalPastRunTrackerName(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PAST_RUN_ITEM_NAME_LENGTH)
    .trim();
}

export function pastRunOreTrackerName(value: unknown, id?: number): string {
  const name = canonicalPastRunTrackerName(value);
  if (id === 30) return "Ruby Ore";
  if (id === 31) return "Jade Ore";
  switch (pastRunItemNameKey(name)) {
    case "ruby": return "Ruby Ore";
    case "jade": return "Jade Ore";
    default: return name;
  }
}

function createRunSummary(
  stats: CompanionStats,
  sessionEndedAt = Date.now(),
  pausedDurationMs = 0,
  itemTotals: ItemDropCounter[] = [],
  runPace: PastRunPace | null = null,
): PastRunSummary {
  return {
    schemaVersion: PAST_RUN_SCHEMA_VERSION,
    id: `${stats.sessionStartedAt}-${sessionEndedAt}`,
    sessionStartedAt: stats.sessionStartedAt,
    sessionEndedAt,
    durationMs: Math.max(sessionEndedAt - stats.sessionStartedAt - pausedDurationMs, 0),
    accountName: stats.accountName,
    tags: [],
    totalGoldGained: stats.totalGoldEarned,
    totalXpGained: stats.totalXpEarned,
    totalKillsGained: stats.totalKillsEarned,
    setDrops: stats.items.Set?.total ?? 0,
    satanicDrops: stats.items.Satanic?.total ?? 0,
    heroicDrops: stats.items.Heroic?.total ?? 0,
    angelicDrops: stats.items.Angelic?.total ?? 0,
    itemTotals: structuredCloneCompat(itemTotals),
    itemBreakdown: structuredCloneCompat(stats.itemBreakdown),
    keys: resourceList(stats.keys),
    ores: resourceList(stats.ores),
    materials: resourceList(stats.materials),
    runPace,
  };
}

export function hasRunActivity(summary: PastRunSummary, itemTimelineCount = 0): boolean {
  const hasItemTotal = (summary.itemTotals ?? []).some((item) => item.total > 0);
  const keyTotal = summary.keys.reduce((total, key) => total + key.total, 0);
  const oreTotal = summary.ores.reduce((total, ore) => total + ore.total, 0);
  const materialTotal = (summary.materials ?? []).reduce((total, material) => total + material.total, 0);
  return (
    summary.totalGoldGained > 0 ||
    summary.totalXpGained > 0 ||
    (summary.totalKillsGained ?? 0) > 0 ||
    (summary.setDrops ?? 0) > 0 ||
    (summary.satanicDrops ?? 0) > 0 ||
    summary.heroicDrops > 0 ||
    summary.angelicDrops > 0 ||
    hasItemTotal ||
    itemTimelineCount > 0 ||
    keyTotal > 0 ||
    oreTotal > 0 ||
    materialTotal > 0
  );
}

function incrementItemTotal(
  items: Map<string, ItemDropCounter>,
  name: string,
  amount: number,
  magicFind: boolean,
): void {
  const normalizedName = normalizePastRunItemName(name);
  const key = pastRunItemNameKey(normalizedName);
  const total = Math.max(amount || 1, 1);
  const existing = items.get(key);
  if (existing) {
    existing.total += total;
    if (magicFind) existing.mf += total;
    return;
  }
  items.set(key, { name: normalizedName, total, mf: magicFind ? total : 0 });
}

function incrementResource(resources: Record<string, ResourceCounter>, id: number, name: string, amount: number): void {
  const total = Math.max(amount || 1, 1);
  resources[name] = resources[name] ?? { id, name, total: 0 };
  resources[name].total += total;
}

function incrementItemBreakdown(items: Record<string, ItemDropCounter>, name: string, amount: number, magicFind: boolean): void {
  const normalizedName = name?.trim() || "Unknown item";
  const total = Math.max(amount || 1, 1);
  items[normalizedName] = items[normalizedName] ?? { name: normalizedName, total: 0, mf: 0 };
  items[normalizedName].total += total;
  if (magicFind) items[normalizedName].mf += total;
}

function resourceList(resources: Record<string, ResourceCounter>): ResourceCounter[] {
  return Object.values(resources)
    .filter((resource) => resource.total > 0)
    .sort((a, b) => a.id - b.id);
}

function itemTotalList(items: Map<string, ItemDropCounter>): ItemDropCounter[] {
  return [...items.values()]
    .filter((item) => item.total > 0)
    .sort((a, b) => pastRunItemNameKey(a.name).localeCompare(pastRunItemNameKey(b.name)))
    .slice(0, MAX_PAST_RUN_ITEM_TOTALS);
}

function structuredCloneCompat<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
