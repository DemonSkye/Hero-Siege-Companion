import assert from "node:assert/strict";
import { test } from "vitest";

import { MATERIAL_LIKE_TIMELINE_TYPES } from "../../src/shared/constants";
import {
  activeItemCatalog,
  canonicalItemCatalogKey,
  type ItemCatalogDefinition,
  type ItemCatalogDomain,
  type ItemCatalogKey,
  type ItemCatalogKeyInput,
  type ItemCatalogResolution,
  type ItemIdentityMode,
} from "../../src/shared/item-catalog";
import { lookupItemTranslationByName } from "../../src/shared/item-lookup";
import { lookupKnownItemRarity } from "../../src/shared/item-rarity";
import { captureMessages, identifyEvent, messageToEvents } from "../../src/shared/parser";
import { hasRunActivity, PAST_RUN_SCHEMA_VERSION, StatsEngine } from "../../src/shared/stats";

// These specs are packet-shaped on purpose. They preserve the odd payloads and
// edge cases we have seen in Hero Siege traffic so parser changes break here
// before they break live capture, item counters, or Past Runs.

test("identifies renamed packet fields from PR25", () => {
  const cases = [
    [{ currency_data: {} }, "updateGold"],
    [{ total_guild_xp: 10 }, "updateXP"],
    [{ added_item_object: { rarity: "Satanic", item_id: 1 } }, "itemAdded"],
    [{ satanic_zone_name: "SZ_1_1", zone_buffs: [1] }, "updateSatanicZone"],
    [{ experience: 123, season: 10 }, "updateAccount"],
  ];

  for (const [payload, eventName] of cases) {
    assert.equal(identifyEvent(payload), eventName);
  }
});

test("nested payloads flatten into events", () => {
  const payloads = [
    [
      { currency_data: { gss: 100, gsh: 0, gns: 0, gnh: 0, gbp: 0 } },
      { total_guild_xp: 500, message: "Gained 15 XP" },
    ],
    { satanic_zone_name: "SZ_1_1", zone_buffs: [1, 26] },
  ];

  const events = messageToEvents(payloads);

  assert.deepEqual(events.map((event) => event.name), ["updateGold", "updateXP", "updateSatanicZone"]);
  assert.equal(events[0].value.GSS, 100);
  assert.equal(events[1].value, 15);
  assert.match(events[2].value.zone, /Act 1/);
});

test("query string nested JSON values are deserialized", () => {
  const events = messageToEvents([{ currency_data: "{\"gss\":321,\"gsh\":0,\"gns\":0,\"gnh\":0,\"gbp\":0}" }]);

  assert.equal(events[0].name, "updateGold");
  assert.equal(events[0].value.GSS, 321);
});

test("satanic zone request route is recovered from compact protocol framing", () => {
  const messages = captureMessages("f0a2c3e4f843R satanic_zone_getRunique_account_id=3437205&crossregion_identifier=abc");
  const message = messages[0] as Record<string, unknown>;

  assert.equal(message.route, "satanic_zone_get");
  assert.equal(message.unique_account_id, "3437205");
  assert.equal(message.crossregion_identifier, "abc");
});

test("versioned query routes retain every path segment", () => {
  const messages = captureMessages(
    "frame inventory/item_generate/v1 account_id=123&item_data=%7B%22id%22%3A1%7D&season=11",
  );
  const message = messages[0] as Record<string, unknown>;

  assert.equal(message.route, "inventory/item_generate/v1");
  assert.deepEqual(message.item_data, { id: 1 });
});

test("save query snapshots recover account, XP, and kill totals", () => {
  const messages = captureMessages(
    'save account_id=123&slot_data={"name":"Dante","experience":5000,"statisticTotalMonsterKills":250,"season":11,"hardcore":0,"blood_pact":0}&beta=0',
  );
  const events = messageToEvents(messages);

  assert.deepEqual(events.map((event) => event.name), ["updateAccount"]);
  assert.deepEqual(events[0].value, {
    name: "Dante",
    experience: 5000,
    hasExperience: true,
    totalMonsterKills: 250,
    season: 11,
    hardcore: 0,
    bloodPact: 0,
    seasonMode: "GSS",
  });
});

test("satanic zone query payloads load zone effects from compact framing", () => {
  const messages = captureMessages("f0a2c3e4f843R satanic_zone_getRsatanic_zone_name=Act_06_02&zone_buffs=17|14|9&zone_debuffs=15|18");
  const events = messageToEvents(messages);
  const zone = events[0].value;

  assert.equal(events[0].name, "updateSatanicZone");
  assert.equal(zone.rawZone, "Act_06_02");
  assert.equal(zone.zone, "Act 6: The Cathedral");
  assert.deepEqual(zone.pros.map((effect) => effect.name), ["Recruit", "Artifact Digger", "Rapid Casting"]);
  assert.deepEqual(zone.cons.map((effect) => effect.name), ["Lingering Evil", "Abnormal Dwelling"]);
});

test("Season 11 live Satanic Zone responses reach stats unchanged", () => {
  const messages = captureMessages(
    '{"status":"1","message":"success","satanicZoneName":"Act_08_03","buffs":"21|22|5","debuffs":"25|18"}',
  );
  const events = messageToEvents(messages);
  const snapshot = new StatsEngine().applyEvents(events);

  assert.equal(events.length, 1);
  assert.equal(events[0].name, "updateSatanicZone");
  assert.equal(snapshot.satanicZone?.rawZone, "Act_08_03");
  assert.equal(snapshot.satanicZone?.zone, "Act 8: Forgotten Caves");
  assert.equal(snapshot.satanicZone?.pros.length, 3);
  assert.equal(snapshot.satanicZone?.cons.length, 2);
});

test("Season 11 Act 9 Satanic Zone responses resolve current zone names", () => {
  const messages = captureMessages(
    '{"status":"1","message":"success","satanicZoneName":"Act_09_02","buffs":"23|11|18","debuffs":"13|12"}',
  );
  const events = messageToEvents(messages);
  const snapshot = new StatsEngine().applyEvents(events);

  assert.equal(events.length, 1);
  assert.equal(events[0].name, "updateSatanicZone");
  assert.equal(snapshot.satanicZone?.rawZone, "Act_09_02");
  assert.equal(snapshot.satanicZone?.zone, "Act 9: Shipwreck Cove");
  assert.deepEqual(snapshot.satanicZone?.pros.map((effect) => effect.name), [
    "Old Town",
    "Nether Surge",
    "Combat Training",
  ]);
  assert.deepEqual(snapshot.satanicZone?.cons.map((effect) => effect.name), [
    "Absolute Limbo",
    "Consumed Time",
  ]);
});

test("bare currency snapshots update gold after account mode is known", () => {
  const events = messageToEvents([{ gss: 400, gsh: 0, gns: 0, gnh: 0, gbp: 0 }]);
  const stats = new StatsEngine();

  stats.applyEvents(events);
  const snapshot = stats.applyEvents(messageToEvents([{ name: "Player", experience: 1, season: 11, hardcore: 0 }]));

  assert.equal(events[0].name, "updateGold");
  assert.equal(events[0].value.GSS, 400);
  assert.equal(snapshot.seasonMode, "GSS");
  assert.equal(snapshot.totalGold, 400);
});

test("loose currency payloads recover readable gold totals from corrupt framing", () => {
  const messages = captureMessages(
    '����\u0002\u0001����x \u0010{"status":"1","message":"Success!","currencyData":{"account_id":39094,"GSS":1719845,"GSH":0,"GNS":0,"GNH":0,"GBP":0',
  );
  const events = messageToEvents(messages);

  assert.equal(events[0].name, "updateGold");
  assert.equal(events[0].value.accountId, 39094);
  assert.equal(events[0].value.GSS, 1719845);
});

test("gold snapshots track current gold and earned positive deltas", () => {
  const stats = new StatsEngine();

  stats.applyEvents(messageToEvents([{ name: "Player", experience: 1, season: 11, hardcore: 0 }]));
  stats.applyEvents(messageToEvents([{ currencyData: { account_id: 39094, GSS: 1719845, GSH: 0, GNS: 0, GNH: 0, GBP: 0 } }]));
  const snapshot = stats.applyEvents(messageToEvents([{ currencyData: { account_id: 39094, GSS: 1719900, GSH: 0, GNS: 0, GNH: 0, GBP: 0 } }]));

  assert.equal(snapshot.totalGold, 1719900);
  assert.equal(snapshot.totalGoldEarned, 55);
});

test("account snapshots track character kill deltas", () => {
  const stats = new StatsEngine();

  stats.applyEvents(messageToEvents([{ name: "Player", experience: 1, season: 10, hardcore: 0, statisticTotalMonsterKills: 147000 }]));
  const snapshot = stats.applyEvents(messageToEvents([{ name: "Player", experience: 1, season: 10, hardcore: 0, statisticTotalMonsterKills: 147031 }]));
  const summary = stats.runSummary(Date.now() + 60_000);

  assert.equal(snapshot.totalKills, 147031);
  assert.equal(snapshot.totalKillsEarned, 31);
  assert.equal(summary.totalKillsGained, 31);
});

test("active character identity packets set the displayed character without resetting XP", () => {
  const stats = new StatsEngine();

  stats.applyEvents(messageToEvents([{ name: "Dante", experience: 5000, season: 10, hardcore: 0 }]));
  const events = messageToEvents([
    {
      name: "Dante",
      accountUID: 3909410,
      class: 11,
      level: 164,
      hardcore: 0,
      season: 10,
      cross_region_identifier: "12000987609",
    },
  ]);
  const snapshot = stats.applyEvents(events);

  assert.deepEqual(events.map((event) => event.name), ["updateAccount"]);
  assert.equal(snapshot.accountName, "Dante");
  assert.equal(snapshot.totalXp, 5000);
});

test("nearby player list entries do not overwrite the active character name", () => {
  const stats = new StatsEngine();

  stats.applyEvents(messageToEvents([{ name: "Dante", accountUID: 3909410, hardcore: 0, season: 10, cross_region_identifier: "12000987609" }]));
  const playerListEvents = messageToEvents([
    {
      name: "OpBlast",
      accountUID: 555001,
      cross_region_identifier: "12000555001",
      nameColor: 6805557,
      level: 146,
      class: 22,
      heroLevel: 146,
      platformUserName: "OpKryptonite",
      uid: 185295201,
      region: 3,
      slot: 21,
      hardcore: 0,
      hc: 0,
      ssf: 1,
      season: 10,
      bloodPact: 0,
    },
  ]);
  const snapshot = stats.applyEvents(playerListEvents);

  assert.deepEqual(playerListEvents.map((event) => event.name), []);
  assert.equal(snapshot.accountName, "Dante");
});

test("account mode packets accept account id context without a route field", () => {
  const events = messageToEvents([{ accountId: 39094, seasonal: 0, hardcore: 0, bloodPact: 6788 }]);

  assert.deepEqual(events.map((event) => event.name), ["updateAccountMode"]);
  assert.equal(events[0].value.seasonMode, "GBP");
});

test("blood pact route packets set GBP mode before gold snapshots arrive", () => {
  const stats = new StatsEngine();
  const modeEvents = messageToEvents([
    {
      route: "inventory/item_stack_handler/v1",
      account_id: 39094,
      seasonal: 0,
      hardcore: 0,
      blood_pact: 6788,
    },
  ]);

  stats.applyEvents(modeEvents);
  const snapshot = stats.applyEvents([
    ...messageToEvents([{ currencyData: { account_id: 39094, GSS: 10, GSH: 0, GNS: 20, GNH: 0, GBP: 30 } }]),
  ]);

  assert.deepEqual(modeEvents.map((event) => event.name), ["updateAccountMode"]);
  assert.equal(snapshot.seasonMode, "GBP");
  assert.equal(snapshot.totalGold, 30);
  assert.equal(snapshot.totalXp, 0);
});

test("gold mode changes reset baseline instead of counting cross-mode totals as earned", () => {
  const stats = new StatsEngine();
  const currencyEvents = messageToEvents([{ currencyData: { account_id: 39094, GSS: 2797371, GSH: 0, GNS: 0, GNH: 0, GBP: 278 } }]);

  stats.applyEvents(messageToEvents([{ route: "inventory/item_stack_handler/v1", seasonal: 0, hardcore: 0, blood_pact: 6788 }]));
  stats.applyEvents(currencyEvents);
  let snapshot = stats.applyEvents(messageToEvents([{ name: "Player", experience: 1, season: 11, hardcore: 0 }]));

  assert.equal(snapshot.seasonMode, "GSS");
  assert.equal(snapshot.totalGold, 2797371);
  assert.equal(snapshot.totalGoldEarned, 0);

  stats.applyEvents(messageToEvents([{ route: "inventory/item_stack_handler/v1", seasonal: 0, hardcore: 0, blood_pact: 6788 }]));
  snapshot = stats.applyEvents(messageToEvents([{ name: "Player", experience: 1, season: 11, hardcore: 0 }]));

  assert.equal(snapshot.totalGold, 2797371);
  assert.equal(snapshot.totalGoldEarned, 0);
});

test("gold snapshots take precedence over noisy delta fields", () => {
  const stats = new StatsEngine();

  stats.applyEvents(messageToEvents([{ name: "Player", experience: 1, season: 11, hardcore: 0 }]));
  stats.applyEvents(messageToEvents([{ currencyData: { account_id: 39094, GSS: 1000, GSH: 0, GNS: 0, GNH: 0, GBP: 0 } }]));
  const snapshot = stats.applyEvents(messageToEvents([{ goldAmount: 999999, currencyData: { account_id: 39094, GSS: 1100, GSH: 0, GNS: 0, GNH: 0, GBP: 0 } }]));

  assert.equal(snapshot.totalGold, 1100);
  assert.equal(snapshot.totalGoldEarned, 100);
});

test("parser skips hostile message fields without throwing", () => {
  const hostile = {};
  Object.defineProperty(hostile, "currencyData", {
    enumerable: true,
    get() {
      throw new Error("hostile getter");
    },
  });

  assert.doesNotThrow(() => messageToEvents([hostile]));
  assert.deepEqual(messageToEvents([hostile]), []);
});

test("capture accepts JSON arrays", () => {
  const messages = captureMessages('prefix [{"total_guild_xp":500,"message":"Gained 15 XP"}] suffix');
  const events = messageToEvents(messages);

  assert.equal(events[0].name, "updateXP");
  assert.equal(events[0].value, 15);
});

test("satanic zone debuffs are parsed separately from buffs", () => {
  const events = messageToEvents([{ satanicZoneName: "Act_06_02", buffs: "17|14|9", debuffs: "15|18" }]);
  const zone = events[0].value;

  assert.equal(events[0].name, "updateSatanicZone");
  assert.deepEqual(zone.pros.map((effect) => effect.name), ["Recruit", "Artifact Digger", "Rapid Casting"]);
  assert.deepEqual(zone.cons.map((effect) => effect.name), ["Lingering Evil", "Abnormal Dwelling"]);
});

test("satanic debuff id 1 resolves to dusk shroud", () => {
  const events = messageToEvents([{ satanicZoneName: "Act_01_01", debuffs: "1" }]);
  const zone = events[0].value;

  assert.deepEqual(zone.cons.map((effect) => effect.name), ["Dusk's Shroud"]);
  assert.equal(zone.cons[0].description, "Light Radius decreased by 20%");
});

test("capture decodes special base64 item packets", () => {
  const payload = {
    addedItemObject: {
      seed: 1,
      id: 99,
      token_level: 0,
      type: 1,
      drop_quality: 0,
      rarity: 6,
      token: 0,
      tier: 0,
      amount: 1,
      weapon_type: 0,
      market_id: 0,
      mf_drop: 1,
      account: "39094",
    },
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const messages = captureMessages(`xx0${encoded}`);
  const events = messageToEvents(messages);

  assert.equal(events[0].name, "itemAdded");
  assert.equal(events[0].value.rarityName, "Satanic");
  assert.equal(events[0].value.mfDrop, 1);
});

test("mail parser handles empty mailbox strings", () => {
  const events = messageToEvents([{ mail: "No new mail" }, { message: "new mail" }]);

  assert.equal(events[0].name, "updateMail");
  assert.equal(events[0].value, false);
  assert.equal(events[1].value, true);
});

test("item stats accept named rarity and magic find alias", () => {
  const events = messageToEvents([{ added_item_object: { rarity: "Satanic", mfDrop: 1, item_id: 123 } }]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.equal(snapshot.items.Satanic.total, 1);
  assert.equal(snapshot.items.Satanic.mf, 1);
});

test("item parser accepts observed magic-find flag field names", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["mf_drop", { mf_drop: 1 }],
    ["mfDrop", { mfDrop: "1" }],
    ["m", { m: true }],
  ];

  for (const [fieldName, flag] of cases) {
    const events = messageToEvents([
      {
        added_item_object: {
          rarity: "Satanic",
          item_id: 123,
          type: 6,
          addedItemFingerprint: `magic-find-${fieldName}`,
          ...flag,
        },
      },
    ]);

    assert.equal(events[0].name, "itemAdded", fieldName);
    assert.equal(events[0].value.mfDrop, 1, fieldName);
  }
});

test("seeded inventory weapon bases do not count as Heroic without server announcement", () => {
  const events = messageToEvents([
    {
      addedItemObject: {
        source: "inventory",
        fingerprint: "10-3909410-65295343278200001-3",
        label: "Chainsaw",
        seed: 648071015,
        id: 10,
        tokenLevel: 10,
        type: 3,
        dropQuality: 0,
        rarity: 2,
        token: 0,
        tier: 0,
        amount: 1,
        weaponType: 7,
        marketId: 0,
        mfDrop: 1,
        sockets: 0,
        account: "",
      },
    },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.equal(events[0].name, "itemAdded");
  assert.equal(events[0].value.label, "War Saw");
  assert.equal(events[0].value.rarityName, "Superior");
  assert.equal(events[0].value.mfDrop, 1);
  assert.equal(snapshot.items.Heroic.total, 0);
  assert.equal(snapshot.items.Heroic.mf, 0);
  assert.equal(snapshot.itemTimeline[0].label, "War Saw");
});

test("item stats count only selected tracked rarities", () => {
  const events = messageToEvents([
    { added_item_object: { rarity: 4, item_id: 1, addedItemFingerprint: "set-1" } },
    { added_item_object: { rarity: 8, item_id: 2, addedItemFingerprint: "blessed-1" } },
    { added_item_object: { rarity: "satanic", item_id: 3, addedItemFingerprint: "satanic-1" } },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.equal(snapshot.items.Set.total, 1);
  assert.equal(snapshot.items.Satanic.total, 1);
  assert.equal(snapshot.items.Blessed, undefined);
});

test("inventory update ext adds items from short fields", () => {
  const payload = {
    status: 1,
    message: "Success on inventory update ext",
    operations: {
      add: {
        "8-4653008-6501d20d1309c0002-1": {
          e: 10,
          m: 1,
          a: 676909917,
          sh: "1f489321a528",
          j: 0,
          b: 71,
          d: 6,
          c: 1,
        },
        "8-4653008-6501d20d1308a0001-6": {
          e: 10,
          a: 624778371,
          sh: "91011929141f",
          j: 0,
          b: 8,
          d: 9,
          c: 0,
        },
      },
    },
  };

  const events = messageToEvents([payload]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.deepEqual(events.map((event) => event.name), ["itemAdded", "itemAdded"]);
  assert.equal(snapshot.items.Satanic.total, 1);
  assert.equal(snapshot.items.Satanic.mf, 1);
  assert.equal(snapshot.items.Heroic.total, 0);
  assert.equal(snapshot.items.Heroic.mf, 0);
});

test("generated charm bases do not inherit fixed charm identities from short ids", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "Success on inventory update ext",
      operations: {
        add: {
          "10-0000000-65643fdba44110001-10": {
            e: 10,
            a: 123456789,
            j: 0,
            b: 59,
            d: 2,
            c: 0,
          },
        },
      },
    },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.equal(events[0].value.label, "Grand Charm");
  assert.equal(events[0].value.localizationId, "charms_normal_grand_charm");
  assert.equal(events[0].value.rarityName, "Superior");
  assert.equal(snapshot.items.Set.total, 0);
});

test("generated charms use extracted base names without treating ambiguous short rarity code 4 as Set", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "Success on inventory update ext",
      operations: {
        add: {
          "10-3909410-659c652b59df30004-10": {
            e: 11,
            a: 345716836,
            j: 0,
            b: 33,
            d: 4,
            c: 0,
          },
          "10-3909410-659b3499336ef0001-10": {
            e: 11,
            a: 652715118,
            j: 0,
            b: 34,
            d: 4,
            c: 0,
          },
        },
      },
    },
  ]);
  const snapshot = new StatsEngine().applyEvents(events);

  assert.deepEqual(events.map((event) => event.value.label), ["Large Charm", "Large Charm"]);
  assert.deepEqual(events.map((event) => event.value.seed), [345716836, 652715118]);
  assert.deepEqual(events.map((event) => event.value.localizationId), [
    "charms_normal_large_charm",
    "charms_normal_large_charm",
  ]);
  assert.deepEqual(events.map((event) => event.value.rarity), [4, 4]);
  assert.deepEqual(events.map((event) => event.value.rarityName), ["Unknown", "Unknown"]);
  assert.deepEqual(snapshot.itemTimeline.map((item) => item.rarity), ["Unknown", "Unknown"]);
  assert.equal(snapshot.items.Set.total, 0);
});

test("generated charm rarity fails closed for long-form and default-normal packet shapes", () => {
  const events = messageToEvents([
    {
      operations: {
        add: {
          "long-form-generated-charm": {
            type: 10,
            id: 33,
            seed: 345716836,
            rarity: 4,
            repository: "normal",
          },
          "10-3909410-default_normal_charm-10": {
            a: 345716836,
            b: 33,
            d: 4,
          },
        },
      },
    },
  ]);
  const snapshot = new StatsEngine().applyEvents(events);

  assert.deepEqual(events.map((event) => event.value.repository), ["normal", "normal"]);
  assert.deepEqual(events.map((event) => event.value.label), ["Large Charm", "Large Charm"]);
  assert.deepEqual(events.map((event) => event.value.rarityName), ["Unknown", "Unknown"]);
  assert.equal(snapshot.items.Set.total, 0);
});

test("repository keeps a generated Large Charm distinct from the colliding fixed charm", () => {
  const events = messageToEvents([
    {
      operations: {
        add: {
          "10-3909410-normal_charm_33-10": { a: 345716836, b: 33, c: 0, d: 4 },
          "10-3909410-fixed_charm_33-10": { a: 987654321, b: 33, c: 1, d: 4 },
        },
      },
    },
  ]);
  const snapshot = new StatsEngine().applyEvents(events);

  assert.deepEqual(events.map((event) => event.value.repository), ["normal", "unique"]);
  assert.deepEqual(events.map((event) => event.value.label), ["Large Charm", "Bag of Unknown Riches"]);
  assert.deepEqual(events.map((event) => event.value.localizationId), [
    "charms_normal_large_charm",
    "charms_bag_of_unknown_riches",
  ]);
  assert.deepEqual(events.map((event) => event.value.rarityName), ["Unknown", "Satanic"]);
  assert.equal(snapshot.items.Set.total, 0);
  assert.equal(snapshot.items.Satanic.total, 1);
});

test("definition-shaped packets use catalog identities for fixed, seeded, stack, and runeword rows", () => {
  const seenKeys: ItemCatalogKey[] = [];
  const events = withItemCatalogResolver((input) => {
    const key = requiredCatalogKey(input);
    seenKeys.push(key);
    const identity = catalogIdentityKey(key);
    if (identity === "normal:0:0:5") {
      return resolvedCatalogItem(key, {
        identityMode: "seeded",
        baseLocalizationId: "helmets_normal_iron_helmet",
        baseName: "Iron Helmet",
      });
    }
    if (identity === "unique:10:0:68") {
      return resolvedCatalogItem(key, {
        identityMode: "fixed",
        localizationId: "charms_crows_feather",
        name: "Crow's Feather",
      });
    }
    if (identity === "normal:12:0:0") {
      return resolvedCatalogItem(key, {
        identityMode: "stack",
        localizationId: "stack_basic_key",
        name: "Basic Key",
      });
    }
    if (identity === "runeword:3:0:1") {
      return resolvedCatalogItem(key, {
        identityMode: "runeword",
        localizationId: "runeword_fixture_blade",
        name: "Fixture Blade",
      });
    }
    return unclassifiedCatalogItem(key);
  }, () => messageToEvents([{
    operations: {
      add: {
        "10-3909410-catalog_seeded_helmet-0": { a: 1001, b: 5, id: 999, c: 0, d: 4 },
        "10-3909410-catalog_fixed_charm-10": { a: 1002, b: 68, c: 1, d: 4, name: "Mammoth Large Charm" },
        "10-3909410-catalog_stack_key-12": { a: 1003, b: 0, c: 0, d: 2 },
        "catalog-runeword": {
          repository: "runeword",
          type: 3,
          id: 1,
          weapon_type: 1,
          rarity: 6,
        },
      },
    },
  }]));
  const snapshot = new StatsEngine().applyEvents(events);

  assert.deepEqual(seenKeys.map(catalogIdentityKey), [
    "normal:0:0:5",
    "unique:10:0:68",
    "normal:12:0:0",
    "runeword:3:0:1",
  ]);
  assert.deepEqual(events.map((event) => event.value.label), ["Iron Helmet", "Crow's Feather", "Basic Key", "Fixture Blade"]);
  assert.deepEqual(events.map((event) => event.value.localizationId), [
    "helmets_normal_iron_helmet",
    "charms_crows_feather",
    "stack_basic_key",
    "runeword_fixture_blade",
  ]);
  assert.deepEqual(events.map((event) => event.value.rarityName), ["Unknown", "Satanic", "Superior", "Satanic"]);
  assert.equal(snapshot.items.Set.total, 0);
});

test("catalog repository identity keeps omitted-c seeded rows distinct from c1 fixed rows", () => {
  const events = withItemCatalogResolver((input) => {
    const key = requiredCatalogKey(input);
    if (key.repository === "normal") {
      return resolvedCatalogItem(key, {
        identityMode: "seeded",
        baseLocalizationId: "charms_normal_large_charm",
        baseName: "Large Charm",
      });
    }
    return resolvedCatalogItem(key, {
      identityMode: "fixed",
      localizationId: "charms_bag_of_unknown_riches",
      name: "Bag of Unknown Riches",
    });
  }, () => messageToEvents([{
    operations: {
      add: {
        "10-3909410-catalog_default_normal_charm-10": { a: 2001, b: 33, d: 4 },
        "10-3909410-catalog_unique_charm-10": { a: 2002, b: 33, c: 1, d: 4 },
      },
    },
  }]));

  assert.deepEqual(events.map((event) => event.value.repository), ["normal", "unique"]);
  assert.deepEqual(events.map((event) => event.value.label), ["Large Charm", "Bag of Unknown Riches"]);
  assert.deepEqual(events.map((event) => event.value.localizationId), [
    "charms_normal_large_charm",
    "charms_bag_of_unknown_riches",
  ]);
  assert.deepEqual(events.map((event) => event.value.rarityName), ["Unknown", "Satanic"]);
});

test("unresolved seeded catalog keys stay generic and never inherit legacy fixed names or Set rarity", () => {
  const events = withItemCatalogResolver((input) => {
    const key = requiredCatalogKey(input);
    if (key.gameId === 50) return unresolvedCatalogItem("missing", key, "seeded");
    if (key.gameId === 61) return unresolvedCatalogItem("quarantined", key, "seeded");
    return unresolvedCatalogItem("out-of-range", key, "seeded");
  }, () => messageToEvents([{
    operations: {
      add: {
        "10-3909410-catalog_missing_seeded_gloves-4": {
          a: 3001,
          b: 50,
          c: 0,
          d: 4,
          name: "Ali's Boxing Gloves",
        },
        "10-3909410-catalog_quarantined_seeded_gloves-4": {
          a: 3002,
          b: 61,
          c: 0,
          d: 4,
          name: "Shade of Sand",
        },
        "10-3909410-catalog_out_of_range_seeded_chest-1": {
          a: 3003,
          b: 17,
          c: 0,
          d: 4,
          name: "Pirate Captain's Shirt",
        },
      },
    },
  }]));
  const snapshot = new StatsEngine().applyEvents(events);

  assert.deepEqual(events.map((event) => event.value.label), ["Gloves #50", "Gloves #61", "Chest #17"]);
  assert.deepEqual(events.map((event) => event.value.localizationId), [undefined, undefined, undefined]);
  assert.deepEqual(events.map((event) => event.value.rarityName), ["Unknown", "Unknown", "Unknown"]);
  assert.equal(snapshot.items.Set.total, 0);
});

test("classified fixed catalog gaps remain generic instead of falling through legacy rows", () => {
  const events = withItemCatalogResolver((input) => {
    const key = requiredCatalogKey(input);
    return unresolvedCatalogItem("missing", key, "fixed");
  }, () => messageToEvents([{
    operations: {
      add: {
        "10-3909410-catalog_missing_fixed_gloves-4": {
          a: 4001,
          b: 50,
          c: 0,
          d: 6,
          name: "Ali's Boxing Gloves",
        },
      },
    },
  }]));

  assert.equal(events[0].value.label, "Gloves #50");
  assert.equal(events[0].value.localizationId, undefined);
  assert.equal(events[0].value.rarityName, "Satanic");
});

test("known fixed charm rarity overrides noisy short Set code", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "Success on inventory update ext",
      operations: {
        add: {
          "10-3909410-178732387221-10": {
            e: 11,
            a: 692011461,
            j: 0,
            b: 68,
            d: 4,
            c: 1,
          },
        },
      },
    },
  ]);
  const snapshot = new StatsEngine().applyEvents(events);

  assert.equal(events[0].value.label, "Crow's Feather");
  assert.equal(events[0].value.localizationId, "charms_crows_feather");
  assert.equal(events[0].value.id, 68);
  assert.equal(events[0].value.type, 10);
  assert.equal(events[0].value.rarity, 4);
  assert.equal(events[0].value.rarityName, "Satanic");
  assert.equal(snapshot.itemTimeline[0].rarity, "Satanic");
  assert.equal(snapshot.items.Satanic.total, 1);
  assert.equal(snapshot.items.Set.total, 0);
});

test("fixed named charms still resolve from short ids", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "Success on inventory update ext",
      operations: {
        add: {
          "10-0000000-fixed_charm-10": {
            e: 10,
            a: 987654321,
            j: 0,
            b: 59,
            d: 2,
            c: 1,
          },
        },
      },
    },
  ]);

  const snapshot = new StatsEngine().applyEvents(events);

  assert.equal(events[0].value.label, "Abomination's Brain");
  assert.equal(events[0].value.localizationId, "charms_abominations_brain");
  assert.equal(events[0].value.rarityName, "Set");
  assert.equal(snapshot.items.Set.total, 1);
});

test("generated ground itemData is not treated as a named drop", () => {
  const payload = {
    status: 1,
    message: "ok",
    itemData: {
      "10-3909410-6526ec544f10a0003-7": {
        n: 4,
        e: 10,
        j: 0,
        gid: 2864038,
        b: 9,
        d: 2,
        c: 0,
        a: 949407396,
        sh: "51ebbc6be752",
      },
    },
    operationTime: 1716400000000,
    itemGenHash: "ground-sync",
  };

  const events = messageToEvents([payload]);

  assert.deepEqual(events, []);
});

test("correlated generated itemData can track c0 drops", () => {
  const fingerprint = "10-3909410-6526f7d8f85a20001-12";
  const events = messageToEvents([
    {
      status: 1,
      message: "ok",
      __hscTrustedGeneratedDrop: true,
      itemData: {
        [fingerprint]: {
          e: 0,
          j: 0,
          gid: 4555085,
          b: 0,
          d: 3,
          c: 0,
          a: 741364673,
          sh: "3c95d08b6c44",
        },
      },
      operationTime: 0.0008349418640136719,
      itemGenHash: "df23fb4b507e9621c6d07cd59149093ea43b02f2b78ceecee29d33f816b7a1b7",
    },
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].name, "itemDropped");
  assert.equal(events[0].value.fingerprint, fingerprint);
  assert.equal(events[0].value.source, "server");
  assert.equal(events[0].value.type, 12);
});

test("correlated c0 data rejects fingerprints with extra components", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "ok",
      __hscTrustedGeneratedDrop: true,
      itemData: {
        "10-3909410-fake-12-extra": {
          a: 741364673,
          b: 0,
          c: 0,
          d: 3,
        },
      },
    },
  ]);

  assert.deepEqual(events, []);
});

test("generated itemData does not treat partial numeric c as the unique repository", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "ok",
      itemData: {
        "10-3909410-invalid_repository-4": {
          a: 741364673,
          b: 0,
          c: "1junk",
          d: 3,
        },
      },
    },
  ]);

  assert.deepEqual(events, []);
});

test("correlated c0 stack identity cannot be retyped or renamed by contradictory fields", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "ok",
      __hscTrustedGeneratedDrop: true,
      itemData: {
        "10-3909410-contradictory_name-12": {
          a: 1,
          b: 0,
          c: 0,
          d: 1,
          name: "Ali's Boxing Gloves",
        },
        "10-3909410-contradictory_type-12": {
          a: 2,
          b: 1,
          c: 0,
          d: 1,
          type: 4,
          id: 50,
        },
      },
    },
  ]);

  assert.deepEqual(events.map((event) => event.value.label), ["Basic Key", "Crystal Key"]);
  assert.deepEqual(events.map((event) => event.value.type), [12, 12]);
  assert.deepEqual(events.map((event) => event.value.id), [0, 1]);
  assert.deepEqual(events.map((event) => event.value.repository), ["normal", "normal"]);
  assert.deepEqual(events.map((event) => event.value.localizationId), ["keys_key", "keys_crystal_key"]);
});

test("correlated generated itemData ignores c0 randomized equipment", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "ok",
      __hscTrustedGeneratedDrop: true,
      itemData: {
        "10-3909410-6526ec544f10a0003-7": {
          e: 10,
          j: 0,
          gid: 2864038,
          b: 9,
          d: 2,
          c: 0,
          a: 949407396,
        },
      },
    },
  ]);

  assert.deepEqual(events, []);
});

test("generated ground itemData is ignored until an inventory pickup event", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "ok",
      itemData: {
        "10-3909410-ground-6": {
          e: 10,
          a: 1,
          b: 8,
          d: 9,
          c: 0,
        },
      },
    },
    {
      status: 1,
      message: "ok",
      operations: {
        stack: {
          "10-3909410-ground-6": {
            pickup_add_data: {
              e: 10,
              a: 1,
              b: 8,
              d: 9,
              c: 0,
            },
          },
        },
      },
    },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.deepEqual(events.map((event) => event.name), ["itemAdded"]);
  assert.equal(snapshot.items.Heroic.total, 0);
  assert.equal(snapshot.itemTimeline.length, 1);
});

test("trusted generated itemData tracks dropped named items before pickup", () => {
  const fingerprint = "10-3909410-6526f323f6e300003-8";
  const events = messageToEvents([
    {
      status: 1,
      message: "ok",
      itemData: {
        "10-3909410-6526f323f6e1a0001-8": {
          n: 2,
          e: 10,
          j: 0,
          gid: 4140471,
          b: 13,
          d: 2,
          c: 0,
          a: 314445609,
          sh: "4d5932bcc19d",
        },
        [fingerprint]: {
          e: 10,
          j: 0,
          gid: 4140865,
          b: 21,
          m: true,
          d: 2,
          c: 1,
          a: 932090865,
          sh: "a695ed322539",
        },
      },
      operationTime: 0.001130819320678711,
      itemGenHash: "df23fb4b507e9621c6d07cd59149093ea43b02f2b78ceecee29d33f816b7a1b7",
    },
    {
      status: 1,
      message: "Success on inventory update ext",
      goldAmount: 0,
      operations: {
        add: {
          [fingerprint]: {
            sh: "a695ed322539",
            a: 932090865,
            e: 10,
            j: 0,
            b: 21,
            m: 1,
            d: 2,
            c: 1,
          },
        },
        log_ids: {
          [fingerprint]: {
            a: 2,
            m: "1073774613",
          },
        },
      },
      newHashes: {},
    },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.deepEqual(events.map((event) => event.name), ["itemDropped", "itemAdded"]);
  assert.equal(events[0].value.fingerprint, fingerprint);
  assert.equal(events[0].value.label, "Sash of the Magi");
  assert.equal(events[0].value.rarityName, "Satanic");
  assert.equal(events[0].value.mfDrop, 1);
  assert.equal(snapshot.items.Satanic.total, 1);
  assert.equal(snapshot.items.Satanic.mf, 1);
  assert.equal(snapshot.itemTimeline.length, 1);
});

test("server just found messages can produce named drop events", () => {
  const events = messageToEvents([
    {
      message: "SERVER: [Softcore] Dante just found [Fumacinha's Favela Flipflop]",
    },
  ]);

  assert.equal(events[0].name, "itemDropped");
  assert.equal(events[0].value.source, "server");
  assert.equal(events[0].value.label, "Fumacinha's Favela Flipflop");
  assert.equal(events[0].value.type, 2);
});

test("named weapon identity supplies its catalog subtype", () => {
  const events = messageToEvents([
    { message: "SERVER: [Softcore] Dante just found [Stofflix Cooking Cleaver]" },
    {
      operations: {
        add: {
          "10-3909410-contradictory_weapon_subtype-3": {
            a: 1,
            b: 35,
            c: 1,
            d: 2,
            j: 7,
            name: "Stofflix Cooking Cleaver",
          },
        },
      },
    },
  ]);

  assert.deepEqual(events.map((event) => event.value.label), [
    "Stofflix Cooking Cleaver",
    "Chainsaw #35",
  ]);
  assert.deepEqual(events.map((event) => event.value.weaponType), [1, 7]);
  assert.deepEqual(events.map((event) => event.value.id), [35, 35]);
});

test("server announcements resolve overridden heroic catalog identities", () => {
  const events = messageToEvents([
    { message: "SERVER: [Softcore] Dante just found [Scourge Loop]" },
  ]);
  const snapshot = new StatsEngine().applyEvents(events);

  assert.equal(events[0].name, "itemDropped");
  assert.equal(events[0].value.label, "Scourge Loop");
  assert.equal(events[0].value.repository, "unique");
  assert.equal(events[0].value.type, 7);
  assert.equal(events[0].value.id, 48);
  assert.equal(events[0].value.rarityName, "Heroic");
  assert.equal(snapshot.items.Heroic.total, 1);
});

test("server announcements retain known rarity when the name spans repositories", () => {
  const events = messageToEvents([
    { message: "SERVER: [Softcore] Dante just found [Ali's Boxing Gloves]" },
  ]);
  const snapshot = new StatsEngine().applyEvents(events);

  assert.equal(events[0].value.label, "Ali's Boxing Gloves");
  assert.equal(events[0].value.repository, "unknown");
  assert.equal(events[0].value.type, 4);
  assert.equal(events[0].value.id, 50);
  assert.equal(events[0].value.localizationId, "gloves_alis_boxing_gloves");
  assert.equal(events[0].value.rarityName, "Heroic");
  assert.equal(snapshot.items.Heroic.total, 1);
});

test("heroic and angelic item identities require server just found messages", () => {
  const inventoryEvents = messageToEvents([
    {
      status: 1,
      message: "Success on inventory update ext",
      operations: {
        add: {
          "2-3768602-6529eca8745200001-3": {
            sh: "4e341ae17885",
            n: 3,
            a: 478771514,
            e: 10,
            j: 4,
            d: 1,
            b: 9,
            c: 0,
          },
        },
      },
      newHashes: {},
    },
  ]);
  const serverEvents = messageToEvents([{ message: "SERVER: [Softcore] Dante just found [Aurelion Fury]" }]);
  const stats = new StatsEngine();
  stats.applyEvents(inventoryEvents);
  const snapshot = stats.applyEvents(serverEvents);

  assert.equal(inventoryEvents[0].value.label, "Naga");
  assert.equal(inventoryEvents[0].value.rarityName, "Common");
  assert.equal(serverEvents[0].value.label, "Aurelion Fury");
  assert.equal(serverEvents[0].value.rarityName, "Angelic");
  assert.equal(snapshot.items.Angelic.total, 1);
  assert.equal(snapshot.itemBreakdown.Angelic["Aurelion Fury"].total, 1);
});

test("submitted research resolves confirmed glove identities without widening heroic inventory counts", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "Success on inventory update ext",
      operations: {
        add: {
          "10-3909410-research_50-4": {
            a: 1,
            b: 50,
            d: 2,
            c: 0,
          },
          "10-3909410-research_61-4": {
            a: 2,
            b: 61,
            d: 2,
            c: 0,
          },
        },
      },
    },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.deepEqual(
    events.map((event) => event.value.label),
    ["Gloves #50", "Gloves #61"],
  );
  assert.equal(events[0].value.rarityName, "Superior");
  assert.equal(events[1].value.rarityName, "Superior");
  assert.equal(snapshot.items.Heroic.total, 0);
  assert.equal(snapshot.items.Satanic.total, 0);
});

test("inventory item_data payloads are treated as picked up items", () => {
  const events = messageToEvents([
    {
      route: "inventory/item_stack_handler/v1",
      item_data: {
        a: 676909917,
        b: 71,
        d: 6,
        c: 1,
        m: 1,
      },
      fingerprint: "8-4653008-6501d20d1309c0002-1",
    },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.equal(events[0].name, "itemAdded");
  assert.equal(events[0].value.rarityName, "Satanic");
  assert.equal(snapshot.items.Satanic.total, 1);
  assert.equal(snapshot.items.Satanic.mf, 1);
});

test("inventory item_data pickup_add_data payloads are treated as picked up items", () => {
  const events = messageToEvents([
    {
      route: "inventory/item_stack_handler/v1",
      item_data: {
        pickup_add_data: {
          a: 624778371,
          b: 8,
          d: 9,
          c: 0,
        },
      },
      fingerprint: "8-4653008-6501d20d1308a0001-6",
    },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.equal(events[0].name, "itemAdded");
  assert.equal(events[0].value.rarityName, "Unknown");
  assert.equal(snapshot.items.Heroic.total, 0);
});

test("common inventory pickups still appear in timeline", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "Success on inventory update ext",
      operations: {
        add: {
          "10-3909410-common-4": {
            e: 10,
            a: 1,
            b: 4,
            d: 1,
            m: 1,
            c: 0,
          },
        },
      },
    },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.equal(snapshot.itemTimeline.length, 1);
  assert.equal(snapshot.itemTimeline[0].rarity, "Common");
  assert.equal(snapshot.itemTimeline[0].label, "Heavy Gloves");
  assert.equal(snapshot.itemTimeline[0].type, 4);
});

test("inventory update ext resolves translated item names from fingerprint type and game id", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "Success on inventory update ext",
      operations: {
        add: {
          "10-3909410-651ed6fc31c090004-6": {
            e: 10,
            a: 180809498,
            j: 0,
            b: 37,
            d: 1,
            m: 1,
            c: 1,
            sh: "e0845426e00d",
          },
          "10-3909410-651ed6fc31aa20002-3": {
            e: 10,
            a: 639807229,
            j: 6,
            b: 5,
            d: 1,
            m: 1,
            c: 1,
            sh: "a3745a4b891d",
          },
          "10-3909410-651ed7394bed90001-8": {
            e: 10,
            a: 632065734,
            j: 0,
            b: 13,
            d: 1,
            c: 1,
            sh: "d25b994b4024",
          },
        },
      },
    },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.deepEqual(
    snapshot.itemTimeline.map((item) => item.label),
    ["Engineer's Toolbelt", "Vanguard's Lance", "Visage of Relentless Rage"],
  );
  assert.equal(snapshot.itemTimeline[1].type, 3);
  assert.equal(snapshot.itemTimeline[1].id, 5);
  assert.equal(snapshot.itemTimeline[1].dropQuality, 0);
});

test("inventory update ext treats fingerprint type zero as helmet", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "Success on inventory update ext",
      operations: {
        add: {
          "10-3909410-651efffb30a3e0001-0": {
            e: 10,
            a: 651945436,
            j: 0,
            b: 63,
            d: 1,
            m: 1,
            c: 1,
            sh: "648ccb61360f",
          },
        },
      },
    },
  ]);

  assert.equal(events[0].value.type, 0);
  assert.equal(events[0].value.id, 63);
  assert.equal(events[0].value.label, "Gabriel's Brimmed Fedora");
});

test("known heroic ring names do not override inventory packets without server announcement", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "Success on inventory update ext",
      operations: {
        add: {
          "10-3909410-651f8a9a56e3a0002-7": {
            e: 10,
            a: 878365858,
            j: 0,
            b: 48,
            d: 1,
            m: 1,
            c: 1,
            sh: "d04d415f4cce",
          },
          "10-3909410-651f8bf96b6ba0001-7": {
            e: 10,
            a: 203653800,
            j: 0,
            b: 3,
            d: 1,
            m: 1,
            c: 1,
            sh: "b529388ebe11",
          },
        },
      },
    },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.equal(events[0].value.label, "Scourge Loop");
  assert.equal(events[0].value.localizationId, "rings_scourge_loop");
  assert.equal(events[0].value.rarityName, "Unknown");
  assert.equal(events[1].value.label, "Stone of Premonition");
  assert.equal(events[1].value.localizationId, "rings_stone_of_jordan");
  assert.equal(events[1].value.rarityName, "Unknown");
  assert.equal(snapshot.items.Set.total, 0);
  assert.equal(snapshot.items.Heroic.total, 0);
  assert.equal(snapshot.items.Satanic.total, 0);
});

test("known item rarities override superior packet rarity", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "Success on inventory update ext",
      operations: {
        add: {
          "10-3909410-bloodletters_crown_33-0": {
            e: 10,
            a: 25605711,
            j: 0,
            b: 33,
            d: 2,
            c: 1,
            sh: "superior-set",
          },
          "10-3909410-wakaykas_tomahawk_0-3": {
            e: 10,
            a: 203653800,
            j: 16,
            b: 0,
            d: 2,
            c: 1,
            sh: "superior-satanic",
          },
        },
      },
    },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.deepEqual(
    events.map((event) => [event.value.label, event.value.rarityName]),
    [
      ["Blood-letter's Crown", "Set"],
      ["Wakayka's Tomahawk", "Satanic"],
    ],
  );
  assert.equal(snapshot.items.Set.total, 1);
  assert.equal(snapshot.items.Satanic.total, 1);
});

test("known item rarity map classifies satanic drops", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "Success on inventory update ext",
      operations: {
        log_ids: {
          "10-3909410-651faeb896c860006-6": { m: "1073766423", a: 2 },
        },
        add: {
          "10-3909410-651faeb896c860006-6": {
            e: 10,
            a: 423215672,
            j: 0,
            b: 23,
            d: 1,
            m: 1,
            c: 1,
            sh: "762b7aed1de4",
          },
        },
      },
    },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.equal(events[0].value.label, "Gem Encrusted Tower");
  assert.equal(events[0].value.rarityName, "Satanic");
  assert.equal(snapshot.items.Satanic.total, 1);
});

test("wiki.gg verified aliases resolve to local item ids and rarities", () => {
  assert.equal(lookupItemTranslationByName("St. Brooks Elementium Pistol")?.localizationId, "w_gun_st_brooks_elementium_pistol");
  assert.equal(lookupItemTranslationByName("Destroyers End")?.localizationId, "rings_destroyers_end");
  assert.equal(lookupItemTranslationByName("Komodos Bloodstrap")?.localizationId, "belts_komodo_dragon_leather_belt");
  assert.equal(lookupItemTranslationByName("Sarcasters Coffee Mug")?.localizationId, "consumable_coffee_mug");

  assert.equal(lookupKnownItemRarity(3, "St. Brooks Elementium Pistol"), "Angelic");
  assert.equal(lookupKnownItemRarity(3, "Commander's Sentry Blaster"), "Angelic");
  assert.equal(lookupKnownItemRarity(18, "Sung Lee's Flask of Carnage"), "Heroic");
  assert.equal(lookupKnownItemRarity(18, "Sarcaster\u2019s Coffee Mug"), "Satanic");
});

test("known item rarity map classifies set boots", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "Success on inventory update ext",
      operations: {
        add: {
          "10-3909410-651efeb9117e70001-2": {
            e: 10,
            a: 334231391,
            j: 0,
            b: 29,
            d: 1,
            c: 1,
            sh: "73ddc76e37c4",
          },
        },
      },
    },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.equal(events[0].value.label, "Earth Shaper's Boots");
  assert.equal(events[0].value.rarityName, "Set");
  assert.equal(snapshot.items.Set.total, 1);
});

test("unknown numeric rarity codes still use known item rarity", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "ok",
      operations: {
        stack: {
          "3-80091501-6522a8a12632f0005-1": {
            target: "3-80091501-6520fd45ae55b0001-1",
            location: 0,
            amount: 1,
            pickup_add_data: {
              d: 22,
              e: 0,
              a: 779271283,
              j: 0,
              b: 17,
              c: 0,
              sh: "ccf01662a7a0",
            },
            targetLocation: 0,
          },
        },
      },
    },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.equal(events[0].value.label, "Chaos Armor");
  assert.equal(events[0].value.rarityName, "Unknown");
  assert.equal(snapshot.items.Set.total, 0);
});

test("known item rarity map classifies known helmets except server-announced rarities", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "Success on inventory update ext",
      operations: {
        add: {
          "10-3909410-651f0490e1ed70001-0": {
            e: 10,
            a: 25605711,
            j: 0,
            b: 74,
            d: 1,
            c: 1,
            sh: "lunar",
          },
          "10-3909410-651f0295cf9d90008-0": {
            e: 10,
            a: 913227823,
            j: 0,
            b: 49,
            d: 1,
            c: 1,
            sh: "lava",
          },
        },
      },
    },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.deepEqual(
    events.map((event) => [event.value.label, event.value.rarityName]),
    [
      ["Lunar Prophet's Tiara", "Set"],
      ["Lava King's Lost Mask", "Unknown"],
    ],
  );
  assert.equal(snapshot.items.Heroic.total, 0);
  assert.equal(snapshot.items.Set.total, 1);
  assert.equal(snapshot.items.Satanic.total, 0);
});

test("stack materials do not increment tracked drop cards", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "Success on inventory update ext",
      operations: {
        stack: {
          "10-3909410-651f0295cfb17000d-14": {
            pickup_add_data: {
              e: 10,
              a: 292420134,
              j: 0,
              b: 60,
              d: 6,
              c: 0,
              sh: "crystal",
            },
          },
        },
      },
    },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.equal(events[0].value.label, "Satanic Crystal Fragment");
  assert.equal(events[0].value.rarityName, "Satanic");
  assert.equal(snapshot.items.Satanic.total, 0);
});

test("timeline keeps older visible drops when hidden material pickups are noisy", () => {
  const stats = new StatsEngine();
  const baseTime = Date.now();
  const events = [
    {
      name: "itemAdded",
      createdAt: baseTime,
      value: {
        rarityName: "Satanic",
        label: "Visible Satanic Drop",
        id: 101,
        type: 4,
        seed: 1,
        dropQuality: 6,
        amount: 1,
        mfDrop: 0,
        fingerprint: "visible-satanic-drop",
      },
    },
  ];

  for (let index = 0; index < 35; index += 1) {
    events.push({
      name: "itemAdded",
      createdAt: baseTime + index + 1,
      value: {
        rarityName: "Satanic",
        label: "Satanic Crystal Fragment",
        id: 60,
        type: 14,
        seed: index + 1,
        dropQuality: 6,
        amount: 1,
        mfDrop: 0,
        fingerprint: `material-${index}`,
      },
    });
  }

  const snapshot = stats.applyEvents(events);
  const visibleAfterHidingMaterials = snapshot.itemTimeline.filter((item) => item.type !== 14);

  assert.equal(visibleAfterHidingMaterials.length, 1);
  assert.equal(visibleAfterHidingMaterials[0].label, "Visible Satanic Drop");
});

test("inventory stack updates resolve known material and key names", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "Success on inventory update ext",
      operations: {
        stack: {
          "10-3909410-651ee11ae22560001-12": {
            pickup_add_data: {
              e: 10,
              a: 972051928,
              j: 0,
              b: 0,
              d: 1,
              c: 0,
              sh: "0137913c41ac",
            },
            amount: 1,
          },
          "10-3909410-651ee14de5a4d0001-14": {
            pickup_add_data: {
              o: 4,
              e: 10,
              a: 130656584,
              j: 0,
              b: 31,
              d: 1,
              c: 0,
              sh: "618398f3bbf7",
            },
            amount: 4,
          },
          "10-3909410-651ee14de5a4d0002-14": {
            pickup_add_data: {
              o: 5,
              e: 10,
              a: 130656585,
              j: 0,
              b: 30,
              d: 1,
              c: 0,
              sh: "618398f3bbf8",
            },
            amount: 5,
          },
          "10-3909410-651ee14de5a4d0003-14": {
            pickup_add_data: {
              o: 1,
              e: 10,
              a: 130656586,
              j: 0,
              b: 35,
              d: 1,
              c: 0,
              sh: "618398f3bbf9",
            },
            amount: 1,
          },
        },
      },
    },
  ]);

  assert.deepEqual(
    events.map((event) => event.value.label),
    ["Basic Key", "Jade Ore", "Ruby Ore", "Satanic Dust"],
  );
  assert.deepEqual(
    events.map((event) => event.value.amount),
    [1, 4, 5, 1],
  );
});

test("manual stack lookup resolves known keys collectibles and materials", () => {
  const events = messageToEvents([
    {
      operations: {
        stack: {
          "10-3909410-key_1-12": {
            pickup_add_data: { a: 1, b: 1, d: 1 },
          },
          "10-3909410-key_19-12": {
            pickup_add_data: { a: 2, b: 19, d: 1 },
          },
          "10-3909410-key_33-12": {
            pickup_add_data: { a: 3, b: 33, d: 1 },
          },
          "10-3909410-collectible_0-13": {
            pickup_add_data: { a: 4, b: 0, d: 1 },
          },
          "10-3909410-collectible_39-13": {
            pickup_add_data: { a: 5, b: 39, d: 1 },
          },
          "10-3909410-collectible_20-13": {
            pickup_add_data: { a: 10, b: 20, d: 1 },
          },
          "10-3909410-collectible_22-13": {
            pickup_add_data: { a: 16, b: 22, d: 1 },
          },
          "10-3909410-collectible_24-13": {
            pickup_add_data: { a: 11, b: 24, d: 1 },
          },
          "10-3909410-collectible_32-13": {
            pickup_add_data: { a: 14, b: 32, d: 1 },
          },
          "10-3909410-collectible_33-13": {
            pickup_add_data: { a: 12, b: 33, d: 1 },
          },
          "10-3909410-collectible_34-13": {
            pickup_add_data: { a: 13, b: 34, d: 1 },
          },
          "10-3909410-collectible_40-13": {
            pickup_add_data: { a: 15, b: 40, d: 1 },
          },
          "10-3909410-material_0-14": {
            pickup_add_data: { a: 6, b: 0, d: 1 },
          },
          "10-3909410-material_32-14": {
            pickup_add_data: { a: 7, b: 32, d: 1 },
          },
          "10-3909410-material_65-14": {
            pickup_add_data: { a: 8, b: 65, d: 1 },
          },
          "10-3909410-material_29-14": {
            pickup_add_data: { a: 9, b: 29, d: 1 },
          },
        },
      },
    },
  ]);

  assert.deepEqual(
    events.map((event) => event.value.label),
    [
      "Crystal Key",
      "Devil's Key",
      "Chaos Key",
      "Battle Fragment",
      "The Hanged Man",
      "The Tower",
      "The Magician",
      "The Wheel of Fortune",
      "Temperance",
      "The Devil",
      "The Moon",
      "The Hierophant",
      "Bloodstone",
      "Tarethium Ore",
      "Blacksmith's Mallet",
      "Gold Ore",
    ],
  );
});

test("run summaries track non-basic keys ore and selected drops", () => {
  const events = messageToEvents([
    {
      operations: {
        stack: {
          "10-3909410-basic_key_0-12": {
            pickup_add_data: { a: 1, b: 0, d: 1, o: 99 },
          },
          "10-3909410-crystal_key_1-12": {
            pickup_add_data: { a: 2, b: 1, d: 1, o: 2 },
          },
          "10-3909410-devils_key_19-12": {
            pickup_add_data: { a: 3, b: 19, d: 1, o: 1 },
          },
          "10-3909410-copper_ore_27-14": {
            pickup_add_data: { a: 4, b: 27, d: 1, o: 7 },
          },
          "10-3909410-iron_ore_28-14": {
            pickup_add_data: { a: 5, b: 28, d: 1, o: 5 },
          },
          "10-3909410-battle_fragment_0-13": {
            pickup_add_data: { a: 6, b: 0, d: 1, o: 3 },
          },
        },
      },
    },
    { message: "SERVER: [Softcore] Dante just found [Fumacinha's Favela Flipflop]" },
    { message: "SERVER: [Softcore] Dante just found [Aurelion Fury]" },
    { added_item_object: { rarity: "Set", item_id: 103, type: 0 } },
    { added_item_object: { rarity: "Satanic", item_id: 104, type: 0 } },
  ]);
  const stats = new StatsEngine();
  stats.applyEvents(events);
  const summary = stats.runSummary();

  assert.deepEqual(
    summary.keys.map((key) => [key.name, key.total]),
    [
      ["Crystal Key", 2],
      ["Devil's Key", 1],
    ],
  );
  assert.deepEqual(
    summary.ores.map((ore) => [ore.name, ore.total]),
    [
      ["Copper Ore", 7],
      ["Iron Ore", 5],
    ],
  );
  assert.deepEqual(
    summary.materials.map((material) => [material.name, material.total]),
    [["Battle Fragment", 3]],
  );
  assert.equal(summary.setDrops, 1);
  assert.equal(summary.satanicDrops, 1);
  assert.equal(summary.heroicDrops, 1);
  assert.equal(summary.angelicDrops, 1);
  assert.equal(Object.values(summary.itemBreakdown.Set).reduce((total, drop) => total + drop.total, 0), 1);
  assert.equal(Object.values(summary.itemBreakdown.Satanic).reduce((total, drop) => total + drop.total, 0), 1);
});

test("run summaries retain deduped ordinary items and canonical resources for exact tracking", () => {
  const ordinaryItemMessage = {
    status: 1,
    message: "Success on inventory update ext",
    operations: {
      add: {
        "10-3909410-common-4": {
          e: 10,
          a: 1,
          b: 4,
          d: 1,
          m: 1,
          c: 0,
        },
      },
    },
  };
  const resourceMessage = {
    operations: {
      stack: {
        "10-3909410-copper_ore_27-14": {
          pickup_add_data: { a: 4, b: 27, d: 1, o: 7 },
        },
        "10-3909410-ruby_ore_30-14": {
          pickup_add_data: { a: 5, b: 30, d: 1, o: 3 },
        },
        "10-3909410-socketable_48-15": {
          pickup_add_data: { a: 6, b: 48, d: 1, o: 2 },
        },
      },
    },
  };
  const events = messageToEvents([
    ordinaryItemMessage,
    ordinaryItemMessage,
    resourceMessage,
    resourceMessage,
  ]);
  const stats = new StatsEngine();

  stats.applyEvents(events);
  const summary = stats.runSummary();

  assert.equal(events.length, 8);
  assert.equal(summary.schemaVersion, PAST_RUN_SCHEMA_VERSION);
  assert.equal(summary.schemaVersion, 3);
  assert.deepEqual(summary.itemTotals, [
    { name: "Copper Ore", total: 7, mf: 0 },
    { name: "Heavy Gloves", total: 1, mf: 1 },
    { name: "Ruby", total: 2, mf: 0 },
    { name: "Ruby Ore", total: 3, mf: 0 },
  ]);
  assert.equal(hasRunActivity(summary), true);

  stats.reset();
  assert.deepEqual(stats.runSummary().itemTotals, []);
});

test("tracked drop cards and breakdowns both count stacked item amounts", () => {
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents([
    {
      name: "itemAdded",
      createdAt: Date.now(),
      value: {
        source: "inventory",
        rarityName: "Satanic",
        label: "Battle Worn Gauntlets",
        id: 1,
        type: 4,
        seed: 1,
        dropQuality: 6,
        amount: 2,
        mfDrop: 1,
        fingerprint: "stacked-satanic",
      },
    },
  ]);

  assert.equal(snapshot.items.Satanic.total, 2);
  assert.equal(snapshot.items.Satanic.mf, 2);
  assert.equal(snapshot.itemBreakdown.Satanic["Battle Worn Gauntlets"].total, 2);
  assert.equal(snapshot.itemBreakdown.Satanic["Battle Worn Gauntlets"].mf, 2);
});

test("truly empty run summaries are not meaningful archive entries", () => {
  const stats = new StatsEngine();
  const summary = stats.runSummary(Date.now() + 1000);

  assert.equal(summary.totalGoldGained, 0);
  assert.equal(summary.totalXpGained, 0);
  assert.equal(summary.keys.length, 0);
  assert.equal(summary.ores.length, 0);
  assert.equal(hasRunActivity(summary), false);
});

test("ordinary item timeline entries make a run meaningful even without rare-drop counters", () => {
  const stats = new StatsEngine();
  const summary = stats.runSummary(Date.now() + 1000);

  assert.equal(hasRunActivity(summary, 1), true);
});

test("run summary duration supports minimum save thresholds", () => {
  const stats = new StatsEngine();
  const startedAt = stats.snapshot().sessionStartedAt;
  const summary = stats.runSummary(startedAt + 5 * 60 * 1000);

  assert.equal(summary.durationMs, 300000);
});

test("battle fragments are treated as material-like timeline noise", () => {
  const events = messageToEvents([
    {
      operations: {
        stack: {
          "10-3909410-collectible_0-13": {
            pickup_add_data: { a: 4, b: 0, d: 1 },
          },
        },
      },
    },
  ]);

  assert.equal(events[0].value.label, "Battle Fragment");
  assert.equal(events[0].value.type, 13);
  assert.equal(MATERIAL_LIKE_TIMELINE_TYPES.has(events[0].value.type), true);
});

test("manual stack lookup resolves known socketables", () => {
  const events = messageToEvents([
    {
      operations: {
        stack: {
          "10-3909410-socketable_1-15": {
            pickup_add_data: { a: 1, b: 1, d: 1 },
          },
          "10-3909410-socketable_30-15": {
            pickup_add_data: { a: 2, b: 30, d: 1 },
          },
          "10-3909410-socketable_35-15": {
            pickup_add_data: { a: 3, b: 35, d: 1 },
          },
          "10-3909410-socketable_68-15": {
            pickup_add_data: { a: 4, b: 68, d: 1 },
          },
          "10-3909410-socketable_111-15": {
            pickup_add_data: { a: 5, b: 111, d: 1 },
          },
          "10-3909410-socketable_118-15": {
            pickup_add_data: { a: 6, b: 118, d: 1 },
          },
          "10-3909410-socketable_134-15": {
            pickup_add_data: { a: 7, b: 134, d: 1 },
          },
        },
      },
    },
  ]);

  assert.deepEqual(
    events.map((event) => event.value.label),
    ["Ol", "Ber", "Flawed Amethyst", "Perfect Topaz", "Uncut Jewel", "Agility", "Perfect Diamond"],
  );
});

test("submitted research resolves infernal stacks runes and codices", () => {
  const stackEntries: Record<string, unknown> = {};
  for (const [type, id] of [
    [13, 45],
    [13, 48],
    [13, 49],
    [13, 50],
    [13, 51],
    [13, 61],
    [13, 64],
    [14, 8],
    [15, 45],
    [15, 51],
    [15, 57],
    [15, 112],
    [15, 113],
    [15, 114],
    [15, 115],
    [15, 116],
    [15, 117],
    [15, 119],
    [15, 120],
    [15, 121],
    [15, 122],
    [15, 124],
    [15, 127],
    [15, 128],
    [15, 129],
  ]) {
    stackEntries[`10-3909410-community_${id}-${type}`] = {
      pickup_add_data: { a: id, b: id, d: 1 },
    };
  }

  const events = messageToEvents([
    {
      operations: {
        stack: stackEntries,
      },
    },
    {
      operations: {
        add: {
          "10-3909410-codex_18-11": {
            a: 18,
            b: 18,
            d: 4,
          },
          "10-3909410-codex_23-11": {
            a: 23,
            b: 23,
            d: 4,
          },
        },
      },
    },
  ]);

  assert.deepEqual(
    events.map((event) => event.value.label),
    [
      "Damien's Infernal Eye",
      "Satan's Infernal Horn",
      "Soul of Infernal Anguish",
      "Soul of Infernal Despair",
      "Soul of Infernal Corruption",
      "Fragment of Nightmare",
      "Fragment of Time",
      "Twilight Citrine",
      "Pristine Emerald",
      "Pristine Ruby",
      "Pristine Sapphire",
      "Goblin",
      "Runeforge",
      "Kobold",
      "Heroism",
      "Angel",
      "Swiftness",
      "Magister",
      "Brute",
      "Wisdom",
      "Relic",
      "Midas",
      "Doom",
      "Fatality",
      "Ancient",
      "Eternity Codex",
      "Infernal Codex",
    ],
  );
});

test("repository and weapon subtype prevent cross-catalog item names", () => {
  const events = messageToEvents([
    {
      operations: {
        add: {
          "10-3909410-normal_cleaver-3": { a: 1, b: 35, c: 0, d: 6, j: 1 },
          "10-3909410-wrong_subtype-3": { a: 2, b: 35, c: 1, d: 6, j: 7 },
          "10-3909410-known_cleaver-3": { a: 3, b: 35, c: 1, d: 6, j: 1 },
        },
      },
    },
  ]);
  const snapshot = new StatsEngine().applyEvents(events);

  assert.deepEqual(events.map((event) => event.value.label), ["Sword #35", "Chainsaw #35", "Stofflix Cooking Cleaver"]);
  assert.deepEqual(events.map((event) => event.value.repository), ["normal", "unique", "unique"]);
  assert.deepEqual(events.map((event) => event.value.weaponType), [1, 7, 1]);
  assert.equal(events[0].value.localizationId, undefined);
  assert.equal(events[1].value.localizationId, undefined);
  assert.equal(snapshot.itemTimeline[1].weaponType, 7);
  assert.equal(snapshot.itemTimeline[1].repository, "unique");
});

test("an explicit catalog name cannot cross its packet repository", () => {
  const events = messageToEvents([
    {
      operations: {
        add: {
          "10-3909410-repository_conflict-3": {
            a: 1,
            b: 35,
            c: 0,
            d: 2,
            j: 1,
            name: "Stofflix Cooking Cleaver",
          },
        },
      },
    },
  ]);

  assert.equal(events[0].value.label, "Sword #35");
  assert.equal(events[0].value.repository, "normal");
  assert.equal(events[0].value.localizationId, undefined);
});

test("native c repository flags take precedence over contradictory long-form metadata", () => {
  const events = messageToEvents([
    {
      operations: {
        add: {
          "10-3909410-native_repository-3": {
            a: 1,
            b: 35,
            c: 0,
            d: 2,
            j: 1,
            repository: "unique",
          },
        },
      },
    },
  ]);

  assert.equal(events[0].value.label, "Sword #35");
  assert.equal(events[0].value.repository, "normal");
  assert.equal(events[0].value.localizationId, undefined);
});

test("definition-shaped items without c use the binary normal-repository default", () => {
  const events = messageToEvents([
    {
      operations: {
        add: {
          "long-form-definition": {
            type: 4,
            id: 50,
            rarity: 2,
          },
        },
      },
    },
  ]);

  assert.equal(events[0].value.label, "Gloves #50");
  assert.equal(events[0].value.repository, "normal");
  assert.equal(events[0].value.localizationId, undefined);
});

test("non-weapon items ignore stray long-form weapon subtype fields", () => {
  const events = messageToEvents([
    {
      operations: {
        add: {
          "long-form-nonweapon-subtype": {
            type: 4,
            id: 50,
            rarity: 2,
            weapon_type: 99,
          },
        },
      },
    },
  ]);

  assert.equal(events[0].value.label, "Gloves #50");
  assert.equal(events[0].value.weaponType, 0);
  assert.equal(events[0].value.localizationId, undefined);
});

test("binary-proven item types stay observable even without catalog names", () => {
  const events = messageToEvents([
    {
      operations: {
        add: {
          "10-3909410-relic-16": { a: 1, b: 155, c: 1, d: 6 },
          "10-3909410-unknown17-17": { a: 2, b: 999, c: 1, d: 6 },
          "10-3909410-unknown19-19": { a: 3, b: 999, c: 1, d: 6 },
        },
      },
    },
  ]);

  assert.deepEqual(events.map((event) => event.value.label), ["Relic #155", "Glyph #999", "Vault #999"]);
  assert.deepEqual(events.map((event) => event.value.type), [16, 17, 19]);
});

test("malformed fingerprints cannot manufacture an item type from b", () => {
  const events = messageToEvents([
    {
      operations: {
        add: {
          "not-a-native-fingerprint": { a: 123456, b: 6, c: 1, d: 6 },
        },
      },
    },
  ]);

  assert.equal(events[0].value.type, -1);
  assert.equal(events[0].value.id, 0);
  assert.equal(events[0].value.label, "Seed 123456");
});

test("a fingerprint type without an ordinal cannot manufacture catalog item zero", () => {
  const events = messageToEvents([
    {
      operations: {
        add: {
          "10-3909410-missing_ordinal-4": { c: 1, d: 2 },
          "10-3909410-missing_normal_ordinal-10": { c: 0, d: 2 },
        },
      },
    },
  ]);

  assert.deepEqual(events.map((event) => event.value.type), [4, 10]);
  assert.deepEqual(events.map((event) => event.value.id), [0, 0]);
  assert.deepEqual(events.map((event) => event.value.label), ["Gloves", "Charm"]);
  assert.deepEqual(events.map((event) => event.value.localizationId), [undefined, undefined]);
});

test("malformed ordinal, type, and repository fields cannot resolve catalog identities", () => {
  const events = messageToEvents([
    {
      operations: {
        add: {
          "10-3909410-invalid_b-4": { a: 1, b: "garbage", c: 1, d: 2 },
          "10-3909410-partial_b-4": { a: 2, b: "0junk", c: 1, d: 2 },
          "10-3909410-null_b-4": { a: 3, b: null, c: 1, d: 2 },
          "invalid-long-id": { a: 4, type: 4, id: null, rarity: 2 },
          "invalid-long-type": { a: 5, type: "bad", id: 5, c: 1, rarity: 2 },
          "invalid-repository": { a: 6, type: 4, id: 50, c: "bad", rarity: 2 },
        },
      },
    },
  ]);

  assert.deepEqual(events.map((event) => event.value.label), [
    "Gloves - Seed 1",
    "Gloves - Seed 2",
    "Gloves - Seed 3",
    "Gloves - Seed 4",
    "Seed 5",
    "Gloves #50",
  ]);
  assert.deepEqual(events.map((event) => event.value.localizationId), [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
  assert.equal(events[4].value.type, -1);
  assert.equal(events[5].value.repository, "unknown");
});

test("present zero-based ordinals remain visible in generic labels", () => {
  const events = messageToEvents([
    {
      operations: {
        add: {
          "10-3909410-zero_helmet-0": { a: 1, b: 0, c: 0, d: 1 },
          "10-3909410-zero_gloves-4": { a: 2, b: 0, c: 0, d: 1 },
          "10-3909410-zero_weapon-3": { a: 3, b: 0, c: 1, d: 1, j: 99 },
        },
      },
    },
  ]);

  assert.deepEqual(events.map((event) => event.value.label), [
    "Cap",
    "Heavy Gloves",
    "Weapon Type 99 #0",
  ]);
});

test("correlated c0 relic-shaped data remains outside the trusted stack set", () => {
  const events = messageToEvents([
    {
      status: 1,
      message: "ok",
      __hscTrustedGeneratedDrop: true,
      itemData: {
        "10-3909410-untrusted_relic-16": { a: 1, b: 155, c: 0, d: 6 },
      },
    },
  ]);

  assert.deepEqual(events, []);
});

test("stack pickup wrappers preserve outer amount and nested pickup data", () => {
  const events = messageToEvents([
    {
      operations: {
        stack: {
          "10-3909410-outer_amount-12": {
            amount: 7,
            pickup_add_data: { a: 1, b: 1, c: 0, d: 1 },
          },
        },
      },
    },
    {
      itemData: {
        "10-3909410-nested_pickup-14": {
          pickup_add_data: { a: 2, b: 29, c: 0, d: 1, o: 3 },
        },
      },
    },
  ]);

  assert.deepEqual(events.map((event) => event.value.label), ["Crystal Key", "Gold Ore"]);
  assert.deepEqual(events.map((event) => event.value.amount), [7, 3]);
});

test("unknown fingerprint ids use item type names instead of bare ids", () => {
  const events = messageToEvents([
    {
      operations: {
        stack: {
          "10-3909410-651ee14de5a4d0001-14": {
            pickup_add_data: {
              o: 5,
              e: 10,
              a: 130656585,
              j: 0,
              b: 24,
              d: 1,
              c: 0,
            },
          },
        },
      },
    },
  ]);

  assert.equal(events[0].value.label, "Bronze Framing");
});

type CatalogFixtureIdentity =
  | {
      identityMode: "seeded";
      baseLocalizationId: string;
      baseName: string;
    }
  | {
      identityMode: "fixed" | "stack" | "runeword";
      localizationId: string;
      name: string;
    };

function withItemCatalogResolver<T>(
  resolver: (input: ItemCatalogKeyInput) => ItemCatalogResolution,
  run: () => T,
): T {
  const originalResolve = activeItemCatalog.resolve;
  activeItemCatalog.resolve = resolver;
  try {
    return run();
  } finally {
    activeItemCatalog.resolve = originalResolve;
  }
}

function requiredCatalogKey(input: ItemCatalogKeyInput): ItemCatalogKey {
  const key = canonicalItemCatalogKey(input);
  if (!key) throw new Error("Expected a valid parser catalog fixture key");
  return key;
}

function catalogIdentityKey(key: ItemCatalogKey): string {
  return `${key.repository}:${key.type}:${key.weaponType}:${key.gameId}`;
}

function catalogDomain(key: ItemCatalogKey, identityMode: ItemIdentityMode): ItemCatalogDomain {
  return {
    id: `parser-fixture-${key.repository}-${key.type}-${key.weaponType}`,
    repository: key.repository,
    type: key.type,
    weaponType: key.weaponType,
    defaultIdentityMode: identityMode,
    status: "partial",
    sourceRefs: ["parser-fixture"],
    expectedItems: [{ gameId: key.gameId, identityMode }],
  };
}

function resolvedCatalogItem(key: ItemCatalogKey, identity: CatalogFixtureIdentity): ItemCatalogResolution {
  const definition = {
    ...key,
    ...identity,
    provenanceRef: "parser-fixture",
  } as ItemCatalogDefinition;
  return {
    status: "resolved",
    key,
    domain: catalogDomain(key, identity.identityMode),
    definition,
  };
}

function unresolvedCatalogItem(
  status: "missing" | "quarantined" | "out-of-range",
  key: ItemCatalogKey,
  expectedIdentityMode: ItemIdentityMode,
): ItemCatalogResolution {
  const domain = catalogDomain(key, expectedIdentityMode);
  if (status === "missing") {
    return {
      status,
      key,
      domain,
      expectedIdentityMode,
      missing: {
        ...key,
        expectedIdentityMode,
        reason: "parser fixture missing identity",
        sourceRefs: ["parser-fixture"],
      },
    };
  }
  if (status === "quarantined") {
    return {
      status,
      key,
      domain,
      expectedIdentityMode,
      quarantine: {
        ...key,
        expectedIdentityMode,
        reason: "parser fixture quarantined identity",
        candidates: [
          { identityMode: expectedIdentityMode, provenanceRef: "parser-fixture-a" },
          { identityMode: expectedIdentityMode, provenanceRef: "parser-fixture-b" },
        ],
      },
    };
  }
  return { status, key, domain, expectedIdentityMode };
}

function unclassifiedCatalogItem(key: ItemCatalogKey): ItemCatalogResolution {
  return { status: "unclassified", key, reason: "no-domain" };
}
