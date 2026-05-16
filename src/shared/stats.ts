import { EVENT_NAMES } from "./constants";
import type { AccountInfo, AddedItemObject, CurrencyData, ParsedEvent, SatanicZoneInfo } from "./parser";

export interface ItemCounter {
  total: number;
  mf: number;
}

export interface ItemTimelineEntry {
  rarity: string;
  label: string;
  localizationId?: string;
  id: number;
  type: number;
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
  items: Record<string, ItemCounter>;
  itemsPerHour: Record<string, number>;
  itemTimeline: ItemTimelineEntry[];
  satanicZone: SatanicZoneInfo | null;
  lastEventAt: number | null;
}

const TRACKED_RARITIES = ["Set", "Satanic", "Heroic", "Angelic"];
const UNTRACKED_ITEM_TYPES = new Set([12, 13, 14, 15]);
const MAX_ITEM_TIMELINE_ENTRIES = 500;

export class StatsEngine {
  private stats: CompanionStats = createInitialStats();
  private seenItemFingerprints = new Set<string>();
  private lastCurrencyData: CurrencyData | null = null;

  reset(): CompanionStats {
    this.stats = createInitialStats();
    this.seenItemFingerprints.clear();
    this.lastCurrencyData = null;
    return this.snapshot();
  }

  applyEvents(events: ParsedEvent[]): CompanionStats {
    for (const event of events) this.applyEvent(event);
    this.recalculateRates();
    return this.snapshot();
  }

  snapshot(): CompanionStats {
    return structuredCloneCompat(this.stats);
  }

  private applyEvent(event: ParsedEvent): void {
    this.stats.lastEventAt = event.createdAt;

    if (event.name === EVENT_NAMES.account) {
      const account = event.value as AccountInfo;
      this.stats.accountName = account.name || this.stats.accountName;
      this.stats.seasonMode = account.seasonMode;
      this.updateXpTotal(account.experience);
      if (this.lastCurrencyData) this.updateGold(this.lastCurrencyData);
    } else if (event.name === EVENT_NAMES.gold) {
      this.updateGold(event.value as CurrencyData);
    } else if (event.name === EVENT_NAMES.xp) {
      const xp = Number(event.value) || 0;
      this.stats.totalXp += Math.trunc(xp / 0.15);
      this.stats.totalXpEarned += Math.trunc(xp / 0.15);
    } else if (event.name === EVENT_NAMES.mail) {
      this.stats.hasMail = Boolean(event.value);
    } else if (event.name === EVENT_NAMES.item) {
      this.updateItem(event.value as AddedItemObject, event.createdAt);
    } else if (event.name === EVENT_NAMES.satanicZone) {
      this.updateSatanicZone(event.value as SatanicZoneInfo);
    }
  }

  private updateGold(currency: CurrencyData): void {
    this.lastCurrencyData = currency;

    if (currency.delta && currency.delta > 0) {
      this.stats.totalGoldEarned += currency.delta;
      if (this.stats.totalGold !== 0) this.stats.totalGold += currency.delta;
      return;
    }

    const mode = this.stats.seasonMode;
    if (!mode) return;

    const currentGold = currency[mode as keyof CurrencyData];
    if (typeof currentGold !== "number") return;

    if (this.stats.totalGold !== 0) {
      const diff = currentGold - this.stats.totalGold;
      if (diff > 0) this.stats.totalGoldEarned += diff;
    }
    this.stats.totalGold = currentGold;
  }

  private updateXpTotal(totalXp: number): void {
    if (this.stats.totalXp !== 0) {
      const diff = totalXp - this.stats.totalXp;
      if (diff > 0) this.stats.totalXpEarned += diff;
    }
    this.stats.totalXp = totalXp;
  }

  private updateItem(item: AddedItemObject, createdAt: number): void {
    const rarity = item.rarityName;
    const trackedRarity = UNTRACKED_ITEM_TYPES.has(item.type) ? null : normalizeTrackedRarity(rarity);
    if (item.fingerprint) {
      if (this.seenItemFingerprints.has(item.fingerprint)) return;
      this.seenItemFingerprints.add(item.fingerprint);
    }

    if (trackedRarity) {
      this.stats.items[trackedRarity].total += 1;
      if (item.mfDrop === 1) this.stats.items[trackedRarity].mf += 1;
    }

    this.stats.itemTimeline.unshift({
      rarity,
      label: item.label,
      localizationId: item.localizationId,
      id: item.id,
      type: item.type,
      seed: item.seed,
      dropQuality: item.dropQuality,
      amount: item.amount,
      mfDrop: item.mfDrop === 1,
      fingerprint: item.fingerprint,
      createdAt,
    });
    this.stats.itemTimeline = this.stats.itemTimeline.slice(0, MAX_ITEM_TIMELINE_ENTRIES);
  }

  private updateSatanicZone(zone: SatanicZoneInfo): void {
    const hasSpecificZone = typeof zone.act === "number" && typeof zone.area === "number" && zone.rawZone.length > 0;
    const cachedZoneExpired =
      this.stats.satanicZone !== null && Date.now() >= nextHalfHourBoundary(this.stats.satanicZone.updatedAt);

    if (hasSpecificZone) {
      this.stats.satanicZone = zone;
      return;
    }

    if (!this.stats.satanicZone || cachedZoneExpired) {
      this.stats.satanicZone = zone;
    }
  }

  private recalculateRates(): void {
    const hours = Math.max((Date.now() - this.stats.sessionStartedAt) / 3_600_000, 1 / 3600);
    this.stats.goldPerHour = Math.trunc(this.stats.totalGoldEarned / hours);
    this.stats.xpPerHour = Math.trunc(this.stats.totalXpEarned / hours);

    for (const rarity of TRACKED_RARITIES) {
      this.stats.itemsPerHour[rarity] = Math.trunc(this.stats.items[rarity].total / hours);
    }
  }
}

function nextHalfHourBoundary(timestamp: number): number {
  const date = new Date(timestamp);
  const minutes = date.getMinutes();
  const nextMinute = minutes < 30 ? 30 : 60;
  date.setMinutes(nextMinute, 0, 0);
  return date.getTime();
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
  for (const rarity of TRACKED_RARITIES) {
    items[rarity] = { total: 0, mf: 0 };
    itemsPerHour[rarity] = 0;
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
    items,
    itemsPerHour,
    itemTimeline: [],
    satanicZone: null,
    lastEventAt: null,
  };
}

function structuredCloneCompat<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
