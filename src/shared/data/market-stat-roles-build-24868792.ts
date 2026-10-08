// Compatibility adapter. Edit the canonical JSON; see docs/item-data.md.
import data from "./items/build-24868792/item-stats.json";
import { ItemStats } from "../item-stats";
export interface MarketStatRoleDefinition {
  statId: number;
  kind: "quantity" | "class-identifier" | "talent-identifier" | "effect" | "marker" | "categorical" | "collection" | "control-only";
  caption?: string;
  detail: string;
  talentFieldId?: number;
}
export const MARKET_STAT_ROLES_V8: readonly MarketStatRoleDefinition[] = ItemStats.flatMap(stat => stat.role ? [stat.role] : []);
export const MARKET_PROC_FAMILIES_V8 = data.procFamilies;
