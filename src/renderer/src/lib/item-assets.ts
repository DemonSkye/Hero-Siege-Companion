import { lookupItemIconFile } from "../../../shared/item-icons";
import type { ResourceCounter } from "../../../shared/stats";

const itemIconImages = import.meta.glob("../../../../img/items/*", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

const oreImages: Record<string, string> = {
  "Copper Ore": new URL("../../../../img/Material_Copper_Ore.webp", import.meta.url).href,
  "Iron Ore": new URL("../../../../img/Material_Iron_Ore.webp", import.meta.url).href,
  "Gold Ore": new URL("../../../../img/Material_Gold_Ore.webp", import.meta.url).href,
  Ruby: new URL("../../../../img/Material_Ruby_Ore.webp", import.meta.url).href,
  Jade: new URL("../../../../img/Material_Jade_Ore.webp", import.meta.url).href,
  "Tarethium Ore": new URL("../../../../img/Material_Tarethium_Ore.png", import.meta.url).href,
};

const keyImages: Record<string, string> = {
  "Crystal Key": new URL("../../../../img/keys/Keys_Crystal_Key.png", import.meta.url).href,
  "Bifröst Key": new URL("../../../../img/keys/Keys_Bifr_st_Key.png", import.meta.url).href,
  "Smelly Cheese": new URL("../../../../img/keys/Keys_Smelly_Cheese.png", import.meta.url).href,
  "Cellar Key": new URL("../../../../img/keys/Keys_Cellar_Key.png", import.meta.url).href,
  "Tower Key": new URL("../../../../img/keys/Keys_Tower_Key.png", import.meta.url).href,
  "Frosted Key": new URL("../../../../img/keys/Keys_Frosted_Key.png", import.meta.url).href,
  "Copper Key": new URL("../../../../img/keys/Keys_Copper_Key.png", import.meta.url).href,
  "Mystic Key": new URL("../../../../img/keys/Keys_Mystic_Key.png", import.meta.url).href,
  "Rusted Key": new URL("../../../../img/keys/Keys_Rusted_Key.png", import.meta.url).href,
  "Shovel Key": new URL("../../../../img/keys/Keys_Shovel_Key.png", import.meta.url).href,
  "Ancient Key": new URL("../../../../img/keys/Keys_Ancient_Key.png", import.meta.url).href,
  "Tomb Key": new URL("../../../../img/keys/Keys_Tomb_Key.png", import.meta.url).href,
  "Devil's Key": new URL("../../../../img/keys/Keys_Devils_Key.png", import.meta.url).href,
  Pickaxe: new URL("../../../../img/keys/Keys_Pickaxe_Key.png", import.meta.url).href,
  "Battle Key": new URL("../../../../img/keys/Keys_Battle_Key.png", import.meta.url).href,
  "Garden Key": new URL("../../../../img/keys/Keys_Garden_Key.png", import.meta.url).href,
  "Golden Key": new URL("../../../../img/keys/Keys_Golden_Key.png", import.meta.url).href,
  "Axe Key": new URL("../../../../img/keys/Keys_Axe_Key.png", import.meta.url).href,
  "Valor Key": new URL("../../../../img/keys/Keys_Valor_Key.png", import.meta.url).href,
  "Naga Scale Key": new URL("../../../../img/keys/Keys_Naga_Scale_Key.png", import.meta.url).href,
  "Magma Key": new URL("../../../../img/keys/Keys_Magma_Key.png", import.meta.url).href,
  "Helflame Torch": new URL("../../../../img/keys/Keys_Helflame_Torch.png", import.meta.url).href,
  "Warp Key": new URL("../../../../img/keys/Keys_Warp_Key.png", import.meta.url).href,
  "Storage Key": new URL("../../../../img/keys/Keys_Storage_Key.png", import.meta.url).href,
};

export function resourceImage(resource: ResourceCounter, kind: "key" | "ore" | "material"): string {
  if (kind === "key") return keyImages[resource.name] ?? "";
  if (kind === "ore") return oreImages[resource.name] ?? "";
  return itemIconUrl(resource.name) || oreImages[resource.name] || "";
}

export function itemIconUrl(name: string | undefined): string {
  const file = lookupItemIconFile(name);
  return file ? (itemIconImages[`../../../../img/items/${file}`] ?? "") : "";
}
