const test = require("node:test");
const assert = require("node:assert/strict");

const { captureMessages, identifyEvent, messageToEvents } = require("../dist/main/shared/parser.js");
const { hasRunActivity, StatsEngine } = require("../dist/main/shared/stats.js");
const { MATERIAL_LIKE_TIMELINE_TYPES } = require("../dist/main/shared/constants.js");

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
  assert.equal(snapshot.items.Heroic.total, 1);
  assert.equal(snapshot.items.Heroic.mf, 0);
});

test("generated ground loot is not treated as picked up items", () => {
  const payload = {
    status: 1,
    message: "ok",
    itemData: {
      "10-3909410-generated": {
        e: 10,
        a: 1,
        gid: 99,
        b: 4,
        d: 1,
        c: 0,
      },
    },
  };

  const events = messageToEvents([payload]);

  assert.deepEqual(events, []);
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

test("known ring rarities override common packet rarity", () => {
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
  assert.equal(events[0].value.rarityName, "Heroic");
  assert.equal(events[1].value.label, "Stone of Premonition");
  assert.equal(events[1].value.localizationId, "rings_stone_of_jordan");
  assert.equal(events[1].value.rarityName, "Heroic");
  assert.equal(snapshot.items.Set.total, 0);
  assert.equal(snapshot.items.Heroic.total, 2);
  assert.equal(snapshot.items.Satanic.total, 0);
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

test("known item rarity map classifies known helmets", () => {
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
      ["Lava King's Lost Mask", "Heroic"],
    ],
  );
  assert.equal(snapshot.items.Heroic.total, 1);
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
    ["Crystal Key", "Devil's Key", "Chaos Key", "Battle Fragment", "The Hanged Man", "Bloodstone", "Tarethium Ore", "Blacksmith's Mallet", "Gold Ore"],
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
        },
      },
    },
    { added_item_object: { rarity: "Heroic", item_id: 101, type: 0 } },
    { added_item_object: { rarity: "Angelic", item_id: 102, type: 0 } },
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
  assert.equal(summary.setDrops, 1);
  assert.equal(summary.satanicDrops, 1);
  assert.equal(summary.heroicDrops, 1);
  assert.equal(summary.angelicDrops, 1);
  assert.equal(Object.values(summary.itemBreakdown.Set).reduce((total, drop) => total + drop.total, 0), 1);
  assert.equal(Object.values(summary.itemBreakdown.Satanic).reduce((total, drop) => total + drop.total, 0), 1);
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
          "10-3909410-socketable-118-15": {
            pickup_add_data: { a: 5, b: 118, d: 1 },
          },
          "10-3909410-socketable-134-15": {
            pickup_add_data: { a: 6, b: 134, d: 1 },
          },
        },
      },
    },
  ]);

  assert.deepEqual(
    events.map((event) => event.value.label),
    ["Ol Rune", "Ber Rune", "Flawed Amethyst", "Perfect Topaz", "Agility", "Perfect Diamond"],
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
