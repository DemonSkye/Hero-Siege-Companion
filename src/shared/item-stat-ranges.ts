/** Build 24868792, executable SHA256 BA72B95A…6CFDD4DF.
 * Derived from retained constructor translations and independently observed
 * tooltips. Display coverage is separate from the Market filter catalog.
 */
export interface ItemStatRange {
  statId: number;
  name: string;
  minimum: number;
  maximum: number;
  kind: "range" | "scalar";
  unit: "percent" | "flat" | "count" | "unknown";
}

export interface ItemStatDefinition {
  itemKey: string;
  stats: readonly ItemStatRange[];
  /** Compact flags of the independently checked, unmodified generation path. */
  flags: { d: number; e: number; m?: number };
}

const range = (statId: number, name: string, minimum: number, maximum: number,
  unit: ItemStatRange["unit"] = "flat"): ItemStatRange => ({ statId, name, minimum, maximum, kind: "range", unit });
const scalar = (statId: number, name: string, value: number,
  unit: ItemStatRange["unit"] = "flat"): ItemStatRange => ({ statId, name, minimum: value, maximum: value, kind: "scalar", unit });

export const ITEM_STAT_DEFINITIONS: readonly ItemStatDefinition[] = [
  { itemKey: "unique:6:0:38", flags: { d: 4, e: 11, m: 1 }, stats: [
    range(20, "Sockets", 2, 4, "count"), range(29, "Enhanced Defense", 90, 130, "percent"),
    range(60, "Mana", 300, 450), scalar(63, "Mana Replenish", 45, "percent"),
    range(101, "Magic Skill Damage", 12, 20, "percent"), range(154, "Base Defense", 52, 70),
    scalar(157, "Base Block Chance", 60, "percent"), range(196, "Faster Cast Rate", 15, 30, "percent"),
    range(201, "All Skills", 1, 2, "count"),
  ] },
  { itemKey: "unique:6:0:47", flags: { d: 4, e: 11, m: 1 }, stats: [
    range(154, "Base Defense", 14, 18), scalar(157, "Base Block Chance", 40, "percent"),
    range(29, "Enhanced Defense", 50, 70, "percent"), scalar(185, "Triggered skill ID", 103, "unknown"),
    scalar(187, "Unknown stat 187", 10, "unknown"), scalar(186, "Unknown stat 186", 40, "unknown"),
    range(33, "Strength", 20, 30), range(158, "Increased Chance of Blocking", 30, 50, "percent"),
    range(72, "Increased Critical Strike Chance", 5, 10, "percent"),
    range(73, "Increased Critical Strike Damage", 30, 50, "percent"),
  ] },
  { itemKey: "unique:10:0:92", flags: { d: 1, e: 11 }, stats: [
    range(266, "Increased Orbital Projectile Duration", 15, 25, "percent"),
  ] },
];

export function itemStatDefinition(itemKey: string | null): ItemStatDefinition | null {
  return ITEM_STAT_DEFINITIONS.find(definition => definition.itemKey === itemKey) ?? null;
}
