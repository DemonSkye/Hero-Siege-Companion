import assert from "node:assert/strict";
import { test } from "vitest";

import { MATERIAL_LIKE_TIMELINE_TYPES } from "../../src/shared/constants";
import { captureMessages, identifyEvent, messageToEvents } from "../../src/shared/parser";
import { hasRunActivity, StatsEngine } from "../../src/shared/stats";

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

test("bare currency snapshots update gold after account mode is known", () => {
  const events = messageToEvents([{ gss: 400, gsh: 0, gns: 0, gnh: 0, gbp: 0 }]);
  const stats = new StatsEngine();

  stats.applyEvents(events);
  const snapshot = stats.applyEvents(messageToEvents([{ name: "Player", experience: 1, season: 10, hardcore: 0 }]));

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

  stats.applyEvents(messageToEvents([{ name: "Player", experience: 1, season: 10, hardcore: 0 }]));
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
  let snapshot = stats.applyEvents(messageToEvents([{ name: "Player", experience: 1, season: 10, hardcore: 0 }]));

  assert.equal(snapshot.seasonMode, "GSS");
  assert.equal(snapshot.totalGold, 2797371);
  assert.equal(snapshot.totalGoldEarned, 0);

  stats.applyEvents(messageToEvents([{ route: "inventory/item_stack_handler/v1", seasonal: 0, hardcore: 0, blood_pact: 6788 }]));
  snapshot = stats.applyEvents(messageToEvents([{ name: "Player", experience: 1, season: 10, hardcore: 0 }]));

  assert.equal(snapshot.totalGold, 2797371);
  assert.equal(snapshot.totalGoldEarned, 0);
});

test("gold snapshots take precedence over noisy delta fields", () => {
  const stats = new StatsEngine();

  stats.applyEvents(messageToEvents([{ name: "Player", experience: 1, season: 10, hardcore: 0 }]));
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

test("heroic-looking inventory weapon packets do not count without server announcement", () => {
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
  assert.equal(events[0].value.label, "Chainsaw");
  assert.equal(events[0].value.rarityName, "Superior");
  assert.equal(events[0].value.mfDrop, 1);
  assert.equal(snapshot.items.Heroic.total, 0);
  assert.equal(snapshot.items.Heroic.mf, 0);
  assert.equal(snapshot.itemTimeline[0].label, "Chainsaw");
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

  assert.equal(inventoryEvents[0].value.label, "Axe #9");
  assert.equal(inventoryEvents[0].value.rarityName, "Common");
  assert.equal(serverEvents[0].value.label, "Aurelion Fury");
  assert.equal(serverEvents[0].value.rarityName, "Angelic");
  assert.equal(snapshot.items.Angelic.total, 1);
  assert.equal(snapshot.itemBreakdown.Angelic["Aurelion Fury"].total, 1);
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
          "10-3909410-common": {
            e: 10,
            a: 1,
            b: 4,
            d: 1,
            m: 1,
            c: 1,
          },
        },
      },
    },
  ]);
  const stats = new StatsEngine();
  const snapshot = stats.applyEvents(events);

  assert.equal(snapshot.itemTimeline.length, 1);
  assert.equal(snapshot.itemTimeline[0].rarity, "Common");
  assert.equal(snapshot.itemTimeline[0].label, "Gloves - Seed 1");
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

  assert.equal(events[0].value.label, "Ring #48");
  assert.equal(events[0].value.localizationId, undefined);
  assert.equal(events[0].value.rarityName, "Common");
  assert.equal(events[1].value.label, "Ring #3");
  assert.equal(events[1].value.localizationId, undefined);
  assert.equal(events[1].value.rarityName, "Common");
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
          "10-3909410-bloodletters-crown-33-0": {
            e: 10,
            a: 25605711,
            j: 0,
            b: 33,
            d: 2,
            c: 1,
            sh: "superior-set",
          },
          "10-3909410-wakaykas-tomahawk-0-3": {
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

  assert.equal(events[0].value.label, "Pirate Captain's Shirt");
  assert.equal(events[0].value.rarityName, "Set");
  assert.equal(snapshot.items.Set.total, 1);
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
      ["Helmet #49", "Common"],
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
    ["Basic Key", "Jade", "Ruby", "Flawed Amethyst"],
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
          "10-3909410-key-1-12": {
            pickup_add_data: { a: 1, b: 1, d: 1 },
          },
          "10-3909410-key-19-12": {
            pickup_add_data: { a: 2, b: 19, d: 1 },
          },
          "10-3909410-key-33-12": {
            pickup_add_data: { a: 3, b: 33, d: 1 },
          },
          "10-3909410-collectible-0-13": {
            pickup_add_data: { a: 4, b: 0, d: 1 },
          },
          "10-3909410-collectible-39-13": {
            pickup_add_data: { a: 5, b: 39, d: 1 },
          },
          "10-3909410-collectible-20-13": {
            pickup_add_data: { a: 10, b: 20, d: 1 },
          },
          "10-3909410-collectible-24-13": {
            pickup_add_data: { a: 11, b: 24, d: 1 },
          },
          "10-3909410-collectible-33-13": {
            pickup_add_data: { a: 12, b: 33, d: 1 },
          },
          "10-3909410-collectible-34-13": {
            pickup_add_data: { a: 13, b: 34, d: 1 },
          },
          "10-3909410-material-0-14": {
            pickup_add_data: { a: 6, b: 0, d: 1 },
          },
          "10-3909410-material-32-14": {
            pickup_add_data: { a: 7, b: 32, d: 1 },
          },
          "10-3909410-material-65-14": {
            pickup_add_data: { a: 8, b: 65, d: 1 },
          },
          "10-3909410-material-29-14": {
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
      "The Wheel of Fortune",
      "The Devil",
      "The Moon",
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
          "10-3909410-basic-key-0-12": {
            pickup_add_data: { a: 1, b: 0, d: 1, o: 99 },
          },
          "10-3909410-crystal-key-1-12": {
            pickup_add_data: { a: 2, b: 1, d: 1, o: 2 },
          },
          "10-3909410-devils-key-19-12": {
            pickup_add_data: { a: 3, b: 19, d: 1, o: 1 },
          },
          "10-3909410-copper-ore-27-14": {
            pickup_add_data: { a: 4, b: 27, d: 1, o: 7 },
          },
          "10-3909410-iron-ore-28-14": {
            pickup_add_data: { a: 5, b: 28, d: 1, o: 5 },
          },
          "10-3909410-battle-fragment-0-13": {
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

test("empty run summaries can still be archived when explicitly ended", () => {
  const stats = new StatsEngine();
  const summary = stats.runSummary(Date.now() + 1000);

  assert.equal(summary.totalGoldGained, 0);
  assert.equal(summary.totalXpGained, 0);
  assert.equal(summary.keys.length, 0);
  assert.equal(summary.ores.length, 0);
  assert.equal(hasRunActivity(summary), false);
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
          "10-3909410-collectible-0-13": {
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
          "10-3909410-socketable-1-15": {
            pickup_add_data: { a: 1, b: 1, d: 1 },
          },
          "10-3909410-socketable-30-15": {
            pickup_add_data: { a: 2, b: 30, d: 1 },
          },
          "10-3909410-socketable-35-15": {
            pickup_add_data: { a: 3, b: 35, d: 1 },
          },
          "10-3909410-socketable-68-15": {
            pickup_add_data: { a: 4, b: 68, d: 1 },
          },
          "10-3909410-socketable-111-15": {
            pickup_add_data: { a: 5, b: 111, d: 1 },
          },
          "10-3909410-socketable-118-15": {
            pickup_add_data: { a: 6, b: 118, d: 1 },
          },
          "10-3909410-socketable-134-15": {
            pickup_add_data: { a: 7, b: 134, d: 1 },
          },
        },
      },
    },
  ]);

  assert.deepEqual(
    events.map((event) => event.value.label),
    ["Ol Rune", "Ber Rune", "Flawed Amethyst", "Perfect Topaz", "Uncut Jewel of Platoon", "Agility", "Perfect Diamond"],
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
    stackEntries[`10-3909410-community-${id}-${type}`] = {
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
          "10-3909410-codex-18-11": {
            a: 18,
            b: 18,
            d: 4,
          },
          "10-3909410-codex-23-11": {
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

  assert.equal(events[0].value.label, "Material #24");
});
