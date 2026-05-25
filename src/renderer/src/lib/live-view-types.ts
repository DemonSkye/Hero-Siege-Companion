import type { ItemDropCounter } from "../../../shared/stats";

export interface LiveItemTypeOption {
  value: string;
  label: string;
}

export interface LiveTrackedItem {
  rarity: string;
  total: number;
  mf: number;
  perHour: number;
  drops: ItemDropCounter[];
}
