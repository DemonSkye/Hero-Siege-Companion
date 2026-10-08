export type ItemBaseStatUnit = "percent" | "flat" | "count" | "seconds" | "unknown";
export interface ItemBaseNumericValue {
  kind: "scalar" | "range" | "series";
  minimum: number;
  maximum: number;
  /** Native value table; its bounds must not be presented as a roll range. */
  values?: readonly number[];
}
export type ItemBaseStat = { statId: number } & (
  | ItemBaseNumericValue
  | { kind: "dynamic"; description: string }
);
export interface ItemBaseStatMetadata {
  statId: number;
  name: string;
  localizationKey: string;
  nativeMarketMenu: boolean;
  unit: ItemBaseStatUnit;
}
export interface ItemBaseStatDefinition {
  itemKey: string;
  stats: readonly ItemBaseStat[];
  /** All recognized setter values interpreted; not full game/affix coverage. */
  complete: boolean;
}
export interface ItemBaseStatCatalogData {
  steamBuild: number;
  executableVersion: string;
  currentBuildParity: "unverified";
  stats: readonly ItemBaseStatMetadata[];
  items: readonly ItemBaseStatDefinition[];
}
