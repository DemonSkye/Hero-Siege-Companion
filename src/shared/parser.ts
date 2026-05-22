import {
  CURRENT_SEASON,
  EVENT_NAMES,
  type EventName,
  ITEM_RARITY,
  ITEM_TYPE_NAMES,
  SATANIC_BUFFS,
  SATANIC_DEBUFFS,
  SATANIC_DEBUFF_ID_OVERRIDES,
  SATANIC_ZONE_NAMES,
  WEAPON_TYPE_NAMES,
} from "./constants";
import { asMessageObject, getMessageField, hasMessageField, intMessageField, messageEntries, type MessageObject, type MessageValue } from "./fields";
import { lookupItemTranslation, type ItemTranslation } from "./item-lookup";
import { lookupKnownItemRarity } from "./item-rarity";
import { isSetItemName } from "./set-item-names";
import { lookupStackItemTranslation } from "./stack-item-lookup";

const GOLD_FIELDS = ["currencyData", "currency_data"];
const CURRENCY_TOTAL_FIELDS = ["GSS", "gss", "GSH", "gsh", "GNS", "gns", "GNH", "gnh", "GBP", "gbp"];
const XP_TOTAL_FIELDS = ["totalGuildXp", "total_guild_xp", "totalGuildExp", "total_guild_exp"];
const XP_GAIN_FIELDS = ["xp", "experienceGained", "experience_gained"];
const MAIL_FIELDS = ["newMail", "new_mail", "mail"];
const ITEM_WRAPPER_FIELDS = ["addedItemObject", "added_item_object"];
const ITEM_SIGNATURE_FIELDS = ["seed", "a", "itemId", "item_id", "gid"];
const ITEM_RARITY_FIELDS = ["rarity", "itemRarity", "item_rarity", "d"];
const GOLD_DELTA_FIELDS = ["goldAmount", "gold_amount"];
const SATANIC_ZONE_FIELDS = ["satanicZoneName", "satanic_zone_name"];
const ACCOUNT_SIGNATURE_FIELDS = ["name", "class", "class_id", "heroLevel", "herolevel", "season", "hardcore"];
const ACCOUNT_MODE_HINT_FIELDS = ["blood_pact", "bloodPact"];
const ACCOUNT_MODE_SIGNATURE_FIELDS = ["hardcore", "season", "seasonal"];

export interface ParsedEvent<T = unknown> {
  name: EventName;
  value: T;
  raw: MessageObject;
  createdAt: number;
}

export interface CurrencyData {
  accountId: number;
  GSS: number;
  GSH: number;
  GNS: number;
  GNH: number;
  GBP: number;
  delta?: number;
}

export interface AddedItemObject {
  fingerprint?: string;
  label: string;
  localizationId?: string;
  seed: number;
  id: number;
  tokenLevel: number;
  type: number;
  dropQuality: number;
  rarity: string | number;
  rarityName: string;
  token: number;
  tier: number;
  amount: number;
  weaponType: number;
  marketId: number;
  mfDrop: number;
  sockets: number;
  account: string;
}

export interface SatanicBuffInfo {
  id: number;
  name: string;
  description: string;
}

export interface SatanicZoneInfo {
  rawZone: string;
  zone: string;
  act?: number;
  area?: number;
  pros: SatanicBuffInfo[];
  cons: SatanicBuffInfo[];
  buffs: SatanicBuffInfo[];
  updatedAt: number;
}

export interface AccountInfo {
  name: string;
  experience: number;
  season: number;
  hardcore: number;
  bloodPact: number;
  seasonMode: string;
}

export function captureMessages(text: string): MessageValue[] {
  const messages: MessageValue[] = [];

  for (const fragment of splitProtocolFragments(text)) {
    const fragmentMessageStart = messages.length;

    for (const jsonText of extractJsonCandidates(fragment)) {
      try {
        addMessage(messages, JSON.parse(jsonText) as MessageValue);
      } catch {
        // Keep scanning; packet boundaries are often rude.
      }
    }

    const specialMessage = parseSpecialPayload(fragment);
    if (specialMessage) addMessage(messages, specialMessage);

    const queryMessage = parseQueryPayload(fragment);
    if (queryMessage) addMessage(messages, queryMessage);

    if (!messages.slice(fragmentMessageStart).some(hasCurrencyMessage)) {
      const looseCurrencyMessage = parseLooseCurrencyPayload(fragment);
      if (looseCurrencyMessage) addMessage(messages, looseCurrencyMessage);
    }
  }

  return messages;
}

export function messageToEvents(value: MessageValue | MessageValue[] | null | undefined): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  for (const msg of iterMessageObjects(value)) {
    const eventNames = identifyEvents(msg);
    if (eventNames.length === 0) continue;

    for (const eventName of eventNames) {
      if (eventName === EVENT_NAMES.gold) {
        events.push({ name: eventName, value: parseCurrencyData(msg), raw: msg, createdAt: Date.now() });
      } else if (eventName === EVENT_NAMES.xp) {
        events.push({ name: eventName, value: parseXp(msg), raw: msg, createdAt: Date.now() });
      } else if (eventName === EVENT_NAMES.account) {
        events.push({ name: eventName, value: parseAccount(msg), raw: msg, createdAt: Date.now() });
      } else if (eventName === EVENT_NAMES.accountMode) {
        events.push({ name: eventName, value: parseAccount(msg), raw: msg, createdAt: Date.now() });
      } else if (eventName === EVENT_NAMES.mail) {
        events.push({ name: eventName, value: parseMail(msg), raw: msg, createdAt: Date.now() });
      } else if (eventName === EVENT_NAMES.item) {
        for (const item of parseAddedItems(msg)) {
          events.push({ name: eventName, value: item, raw: msg, createdAt: Date.now() });
        }
      } else if (eventName === EVENT_NAMES.satanicZone) {
        events.push({ name: eventName, value: parseSatanicZone(msg), raw: msg, createdAt: Date.now() });
      }
    }
  }
  return events;
}

export function identifyEvent(msg: MessageObject): EventName | null {
  return identifyEvents(msg)[0] ?? null;
}

function identifyEvents(msg: MessageObject): EventName[] {
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.steam) return [];

  const events: EventName[] = [];
  const message = String(getMessageField(msg, ["message"], "")).toLowerCase();

  if (hasMessageField(msg, GOLD_FIELDS) || hasCurrencyTotals(msg) || hasPositiveGoldDelta(msg)) events.push(EVENT_NAMES.gold);
  if (hasMessageField(msg, XP_TOTAL_FIELDS)) events.push(EVENT_NAMES.xp);
  if (message.includes("mail") || hasMessageField(msg, MAIL_FIELDS)) events.push(EVENT_NAMES.mail);
  if (isItemPayload(msg)) events.push(EVENT_NAMES.item);
  if (hasMessageField(msg, SATANIC_ZONE_FIELDS)) events.push(EVENT_NAMES.satanicZone);
  if (hasMessageField(msg, ["experience"]) && hasMessageField(msg, ACCOUNT_SIGNATURE_FIELDS)) events.push(EVENT_NAMES.account);
  if (hasMessageField(msg, ACCOUNT_MODE_HINT_FIELDS) && hasMessageField(msg, ACCOUNT_MODE_SIGNATURE_FIELDS)) {
    events.push(EVENT_NAMES.accountMode);
  }
  if (hasMessageField(msg, XP_GAIN_FIELDS)) events.push(EVENT_NAMES.xp);

  return events;
}

function* iterMessageObjects(value: MessageValue | MessageValue[] | null | undefined): Iterable<MessageObject> {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) yield* iterMessageObjects(item);
    return;
  }
  if (typeof value === "object") yield value as MessageObject;
}

function isItemPayload(msg: MessageObject): boolean {
  const operations = asMessageObject(getMessageField(msg, ["operations"], {}));
  return (
    hasMessageField(msg, ITEM_WRAPPER_FIELDS) ||
    hasMessageField(operations, ["add", "stack"]) ||
    hasMessageField(msg, ["itemsAdded", "items_added"])
  );
}

function parseCurrencyData(msg: MessageObject): CurrencyData {
  const currencyData = asMessageObject(getMessageField(msg, GOLD_FIELDS, undefined)) ?? msg;
  return {
    accountId: intMessageField(currencyData, ["account_id", "accountId"]),
    GSS: intMessageField(currencyData, ["GSS", "gss"]),
    GSH: intMessageField(currencyData, ["GSH", "gsh"]),
    GNS: intMessageField(currencyData, ["GNS", "gns"]),
    GNH: intMessageField(currencyData, ["GNH", "gnh"]),
    GBP: intMessageField(currencyData, ["GBP", "gbp"]),
    delta: intMessageField(msg, GOLD_DELTA_FIELDS, 0),
  };
}

function hasCurrencyTotals(msg: MessageObject): boolean {
  return CURRENCY_TOTAL_FIELDS.some((field) => hasMessageField(msg, [field]));
}

function hasPositiveGoldDelta(msg: MessageObject): boolean {
  return intMessageField(msg, GOLD_DELTA_FIELDS, 0) > 0;
}

function hasCurrencyMessage(value: MessageValue): boolean {
  const msg = asMessageObject(value);
  if (!msg) return false;
  const currencyData = asMessageObject(getMessageField(msg, GOLD_FIELDS, undefined));
  return Boolean(currencyData && hasCurrencyTotals(currencyData)) || hasCurrencyTotals(msg) || hasPositiveGoldDelta(msg);
}

function parseLooseCurrencyPayload(text: string): MessageObject | null {
  if (!/\b(?:currency|gold|gss|gsh|gns|gnh|gbp)\b/i.test(text)) return null;

  const currencyData: MessageObject = {};
  const accountId = looseIntField(text, ["account_id", "accountId"]);
  if (accountId !== null) currencyData.account_id = accountId;

  for (const field of ["GSS", "GSH", "GNS", "GNH", "GBP"]) {
    const value = looseIntField(text, [field]);
    if (value !== null) currencyData[field] = value;
  }

  if (!hasCurrencyTotals(currencyData)) return null;
  return { currencyData };
}

function looseIntField(text: string, names: string[]): number | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`["']?${escaped}["']?\\s*[:=]\\s*(-?\\d+)`, "i"));
    if (match) return Number.parseInt(match[1], 10);
  }
  return null;
}

function parseXp(msg: MessageObject): number {
  const message = String(getMessageField(msg, ["message"], ""));
  const match = message.match(/\d+/);
  if (match) return Number.parseInt(match[0], 10);
  return intMessageField(msg, XP_GAIN_FIELDS);
}

function parseAccount(msg: MessageObject): AccountInfo {
  const season = intMessageField(msg, ["season"]);
  const hardcore = intMessageField(msg, ["hardcore"]);
  const bloodPact = intMessageField(msg, ["blood_pact", "bloodPact"]);
  let seasonMode = hardcore === 1 ? "GNH" : "GNS";

  if (season === CURRENT_SEASON) seasonMode = hardcore === 1 ? "GSH" : "GSS";
  else if (bloodPact !== 0 && season === 0) seasonMode = "GBP";

  return {
    name: String(getMessageField(msg, ["name"], "")),
    experience: intMessageField(msg, ["experience"]),
    season,
    hardcore,
    bloodPact,
    seasonMode,
  };
}

function parseMail(msg: MessageObject): boolean {
  const newMail = getMessageField(msg, MAIL_FIELDS, undefined);
  if (typeof newMail === "boolean") return newMail;
  if (typeof newMail === "number") return newMail > 0;
  if (typeof newMail === "string") return isTruthyMailText(newMail);
  const message = String(getMessageField(msg, ["message"], "")).toLowerCase();
  return isTruthyMailText(message);
}

function isTruthyMailText(value: string): boolean {
  const normalized = value.toLowerCase().trim();
  if (!normalized) return false;
  if (["0", "false", "none", "no", "clear"].includes(normalized)) return false;
  if (normalized.includes("no mail") || normalized.includes("no new mail") || normalized.includes("mailbox empty")) return false;
  return normalized.includes("mail") || normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseAddedItems(msg: MessageObject): AddedItemObject[] {
  const itemSources = extractItemSources(msg);
  return itemSources.map(({ fingerprint, item }) => parseAddedItemObject(item, fingerprint));
}

function extractItemSources(msg: MessageObject): Array<{ fingerprint?: string; item: MessageObject }> {
  const operations = asMessageObject(getMessageField(msg, ["operations"], {}));
  const operationAdd = asMessageObject(getMessageField(operations, ["add"], undefined));
  if (operationAdd) return objectValuesAsItems(operationAdd);

  const operationStack = asMessageObject(getMessageField(operations, ["stack"], undefined));
  if (operationStack) {
    return messageEntries(operationStack)
      .map(([fingerprint, value]) => ({
        fingerprint,
        item: asMessageObject(getMessageField(asMessageObject(value as MessageValue), ["pickup_add_data", "pickupAddData"], undefined)),
      }))
      .filter((source): source is { fingerprint: string; item: MessageObject } => Boolean(source.item));
  }

  const itemsAdded = asMessageObject(getMessageField(msg, ["itemsAdded", "items_added"], undefined));
  if (itemsAdded) return objectValuesAsItems(itemsAdded);

  const wrapped = asMessageObject(getMessageField(msg, ITEM_WRAPPER_FIELDS, undefined));
  if (wrapped) {
    return [
      {
        fingerprint: String(getMessageField(msg, ["addedItemFingerprint", "added_item_fingerprint", "fingerprint"], "")) || undefined,
        item: wrapped,
      },
    ];
  }

  return [{ item: msg }];
}

function objectValuesAsItems(items: MessageObject): Array<{ fingerprint?: string; item: MessageObject }> {
  return messageEntries(items)
    .filter(([, value]) => value && typeof value === "object" && !Array.isArray(value))
    .map(([fingerprint, item]) => ({ fingerprint, item: item as MessageObject }));
}

function parseAddedItemObject(item: MessageObject, fingerprint?: string): AddedItemObject {
  const rarity = getMessageField(item, ["rarity", "itemRarity", "item_rarity", "d"], 0) as string | number;
  const sockets = [1, 2, 3, 4, 5, 6].filter((slot) => getMessageField(item, [`socket_${slot}`], undefined) !== undefined).length;
  const seed = intMessageField(item, ["seed", "a"]);
  const fingerprintType = parseFingerprintType(fingerprint);
  const hasFingerprintType = fingerprintType !== null;
  const fingerprintItemType = fingerprintType ?? 0;
  const hasExplicitId = hasMessageField(item, ["id", "itemId", "item_id"]);
  const shortGameId = intMessageField(item, ["b"]);
  const id = intMessageField(item, ["id", "itemId", "item_id"]) || (hasFingerprintType ? shortGameId : intMessageField(item, ["gid"]));
  const type = intMessageField(item, ["type", "itemType", "item_type"]) || (hasFingerprintType ? fingerprintItemType : shortGameId);
  const weaponType = intMessageField(item, ["weapon_type", "weaponType"]) || (type === 3 ? intMessageField(item, ["j"]) : 0);
  const dropQuality = intMessageField(item, ["drop_quality", "dropQuality"]) || (type === 3 ? 0 : intMessageField(item, ["j"]));
  const translation = hasExplicitId || hasFingerprintType ? lookupItemTranslation(type, id, weaponType) ?? lookupStackItemTranslation(type, id) : null;
  const rarityName = inferItemRarityName(rarity, item, type, translation);

  return {
    fingerprint,
    label: itemDisplayLabel({ id, type, weaponType, dropQuality, seed, fingerprint, translationName: translation?.name }),
    localizationId: translation?.localizationId,
    seed,
    id,
    tokenLevel: intMessageField(item, ["token_level", "tokenLevel", "e"]),
    type,
    dropQuality,
    rarity,
    rarityName,
    token: intMessageField(item, ["token"]),
    tier: intMessageField(item, ["tier", "n"]),
    amount: intMessageField(item, ["amount", "o"], 1),
    weaponType,
    marketId: intMessageField(item, ["market_id", "marketId"]),
    mfDrop: intMessageField(item, ["mf_drop", "mfDrop", "m"]),
    sockets,
    account: String(getMessageField(item, ["account", "accountId", "account_id"], "")),
  };
}

function inferItemRarityName(rawRarity: string | number, item: MessageObject, type: number, translation: ItemTranslation | null): string {
  const mappedRarity = ITEM_RARITY[String(rawRarity)];

  const identity = `${translation?.localizationId ?? ""} ${translation?.name ?? ""}`.toLowerCase();
  const knownRarity = lookupKnownItemRarity(type, translation?.name);
  if (knownRarity && shouldKnownRarityOverridePacket(mappedRarity)) return knownRarity;
  if (mappedRarity && mappedRarity !== "Common") return mappedRarity;
  if (knownRarity) return knownRarity;

  if (isSetItemName(translation?.name)) return "Set";
  if (identity.includes("blessed")) return "Blessed";
  if (identity.includes("angelic")) return "Angelic";
  if (identity.includes("unholy")) return "Unholy";
  if (identity.includes("satan")) return "Satanic";

  const isSpecialEquipment = Boolean(translation) && intMessageField(item, ["c"]) === 1 && [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 18].includes(type);
  if (isSpecialEquipment) return "Satanic";
  if (mappedRarity) return mappedRarity;

  const fallback = String(rawRarity).replace(/^\w/, (char) => char.toUpperCase());
  return fallback && !/^-?\d+$/.test(fallback) ? fallback : "Unknown";
}

function shouldKnownRarityOverridePacket(mappedRarity: string | undefined): boolean {
  return mappedRarity === undefined || ["Common", "Superior", "Rare", "Mythic"].includes(mappedRarity);
}

function itemDisplayLabel(item: {
  id: number;
  type: number;
  weaponType: number;
  dropQuality: number;
  seed: number;
  fingerprint?: string;
  translationName?: string;
}): string {
  if (item.translationName) return item.translationName;
  if (item.id > 0) return `${itemTypeLabel(item.type, item.weaponType)} #${item.id}`;

  const parts: string[] = [];
  if (item.type > 0) parts.push(itemTypeLabel(item.type, item.weaponType));
  if (item.dropQuality > 0) parts.push(`Q${item.dropQuality}`);
  if (item.seed > 0) parts.push(`Seed ${String(item.seed).slice(-6)}`);
  if (parts.length > 0) return parts.join(" - ");
  if (item.fingerprint) return item.fingerprint;
  return "Unknown item";
}

function itemTypeLabel(type: number, weaponType: number): string {
  if (type === 3 && weaponType > 0) return WEAPON_TYPE_NAMES[weaponType] ?? `Weapon Type ${weaponType}`;
  return ITEM_TYPE_NAMES[type] ?? `Type ${type}`;
}

function parseFingerprintType(fingerprint?: string): number | null {
  if (!fingerprint) return null;
  const match = fingerprint.match(/-(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function parseSatanicZone(msg: MessageObject): SatanicZoneInfo {
  const rawZone = String(getMessageField(msg, ["satanicZoneName", "satanic_zone_name"], ""));
  const buffs = parseSatanicEffects(
    getMessageField(msg, ["buffs", "satanicZoneBuffs", "satanic_zone_buffs", "zoneBuffs", "zone_buffs"], ""),
    SATANIC_BUFFS,
    "Buff",
    1,
  );
  const cons = parseSatanicEffects(
    getMessageField(msg, ["debuffs", "satanicZoneDebuffs", "satanic_zone_debuffs", "zoneDebuffs", "zone_debuffs"], ""),
    SATANIC_DEBUFFS,
    "Debuff",
    2,
    SATANIC_DEBUFF_ID_OVERRIDES,
  );

  const match = rawZone.match(/_(\d+)_(\d+)/);

  if (!match) return { rawZone, zone: rawZone || "Unknown Satanic Zone", pros: buffs, cons, buffs, updatedAt: Date.now() };

  const act = Number.parseInt(match[1], 10);
  const area = Number.parseInt(match[2], 10);
  const zoneName = SATANIC_ZONE_NAMES[act]?.[area - 1];

  return {
    rawZone,
    zone: zoneName ? `Act ${act}: ${zoneName}` : rawZone,
    act,
    area,
    pros: buffs,
    cons,
    buffs,
    updatedAt: Date.now(),
  };
}

function parseSatanicEffects(
  rawEffects: MessageValue | undefined,
  effectDescriptions: Record<string, string>,
  fallbackLabel: string,
  idOffset: number,
  idOverrides: Record<number, string> = {},
): SatanicBuffInfo[] {
  const effectValues = Array.isArray(rawEffects) ? rawEffects : String(rawEffects || "").replace(/,/g, "|").split("|");
  const effectNames = Object.keys(effectDescriptions);

  return effectValues
    .map((effect) => Number.parseInt(String(effect), 10))
    .filter((effect) => Number.isFinite(effect))
    .map((id) => {
      const name = idOverrides[id] ?? effectNames[id - idOffset] ?? `Unknown ${fallbackLabel} ${id}`;
      return { id, name, description: effectDescriptions[name] ?? "No description available yet." };
    });
}

function parseQueryPayload(text: string): MessageObject | null {
  const queryStart = findQueryStart(text);
  if (queryStart === -1 || !text.includes("&")) return null;

  const queryText = text.slice(queryStart).replace(/\0/g, "");
  const params = new URLSearchParams(queryText);
  const msg: MessageObject = {};
  const route = inferRoute(text.slice(0, queryStart));
  if (route) msg.route = route;

  for (const [key, value] of params.entries()) {
    msg[key] = parseQueryValue(value);
  }

  return Object.keys(msg).length > 0 ? msg : null;
}

function findQueryStart(text: string): number {
  const commonFirstKeys = [
    "account_id",
    "unique_account_id",
    "identifier",
    "item_data",
    "fingerprint",
    "item_name",
    "search",
    "query",
    "season",
    "hardcore",
    "beta",
    "checksum",
  ];
  const starts = commonFirstKeys.map((key) => text.indexOf(`${key}=`)).filter((index) => index !== -1);
  if (starts.length > 0) return Math.min(...starts);
  return text.search(/[a-zA-Z0-9_]+=/);
}

function inferRoute(text: string): string {
  const marketStart = text.lastIndexOf("market/");
  if (marketStart !== -1) {
    return text.slice(marketStart).match(/^market\/[a-z0-9_]+/)?.[0] ?? "";
  }

  const matches = Array.from(text.matchAll(/(?:^|[^a-z0-9_])([a-z][a-z0-9_]*\/[a-z0-9_]+)/g));
  return matches.at(-1)?.[1] ?? "";
}

function parseQueryValue(value: string): MessageValue {
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return value;

  try {
    return JSON.parse(trimmed) as MessageValue;
  } catch {
    return value;
  }
}

function splitProtocolFragments(text: string): string[] {
  return text
    .replace(/'b'/g, "")
    .split("\\")
    .map((fragment) => fragment.replace(/\0/g, "").trim())
    .filter(Boolean);
}

function parseSpecialPayload(text: string): MessageValue | null {
  const marker = text.match(/(?:^|[^A-Za-z0-9_=])x.{2}/);
  if (!marker || marker.index === undefined) return null;
  const start = marker[0][0] === "x" ? marker.index : marker.index + 1;

  const candidate = text.slice(start);
  if (candidate.length <= 100 || candidate[0] !== "x") return null;

  const truncated = candidate.slice(3);
  const encoded = truncated.includes("[INV]") ? truncated.split("[INV]").at(-1) ?? "" : truncated;
  if (!encoded) return null;
  if (encoded.includes("&")) return parseQueryPayload(truncated);

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    return JSON.parse(decoded) as MessageValue;
  } catch {
    return null;
  }
}

function addMessage(messages: MessageValue[], value: MessageValue): void {
  if (asMessageObject(value) && (value as MessageObject).steam) return;
  messages.push(value);
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const starts: number[] = [];

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char !== "{" && char !== "[") continue;

    const end = findMatchingJsonEnd(text, i, char, char === "{" ? "}" : "]");
    if (end !== -1) {
      candidates.push(text.slice(i, end + 1));
      starts.push(i);
      i = end;
    }
  }

  return candidates;
}

function findMatchingJsonEnd(text: string, start: number, open: string, close: string): number {
  const stack = [open];
  let inString = false;
  let escaped = false;

  for (let i = start + 1; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{" || char === "[") stack.push(char);
    if (char === "}" || char === "]") {
      const expected = stack[stack.length - 1] === "{" ? "}" : "]";
      if (char !== expected) return -1;
      stack.pop();
      if (stack.length === 0) return i;
    }
  }

  return -1;
}
