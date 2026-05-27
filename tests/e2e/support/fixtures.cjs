function e2eCaptureEvents() {
  const now = Date.now();
  return [
    {
      name: "updateAccount",
      value: {
        name: "E2E Captured",
        experience: 1_000_000,
        totalMonsterKills: 5_000,
        season: 10,
        hardcore: 0,
        bloodPact: 0,
        seasonMode: "GSS",
      },
      raw: {},
      createdAt: now,
    },
    {
      name: "updateGold",
      value: {
        accountId: 1,
        GSS: 750_000,
        GSH: 0,
        GNS: 0,
        GNH: 0,
        GBP: 0,
      },
      raw: {},
      createdAt: now + 1,
    },
    {
      name: "itemDropped",
      value: {
        source: "server",
        fingerprint: "e2e-angelic-blade",
        label: "E2E Angelic Blade",
        seed: 1,
        id: 77,
        tokenLevel: 0,
        type: 3,
        dropQuality: 7,
        rarity: 7,
        rarityName: "Angelic",
        token: 0,
        tier: 0,
        amount: 1,
        weaponType: 1,
        marketId: 0,
        mfDrop: 1,
        sockets: 0,
        account: "E2E Captured",
      },
      raw: {},
      createdAt: now + 2,
    },
  ];
}

function e2eTrafficPayloads() {
  return [
    `frame-noise ${JSON.stringify([
      {
        name: "E2E Packet Runner",
        experience: 1_250_000,
        statisticTotalMonsterKills: 7_500,
        season: 10,
        hardcore: 0,
        bloodPact: 0,
        seasonMode: "GSS",
      },
      {
        currencyData: {
          account_id: 1,
          GSS: 925_000,
          GSH: 0,
          GNS: 0,
          GNH: 0,
          GBP: 0,
        },
      },
      {
        satanicZoneName: "Act_01_01",
        buffs: "1|26",
        debuffs: "15",
      },
      {
        message: "SERVER: [Softcore] E2E Packet Runner just found [Aurelion Fury]",
      },
    ])} trailing-frame-noise`,
  ];
}

function e2eRareDropTrafficPayloads() {
  return [
    `rare-frame ${JSON.stringify([
      {
        name: "E2E Drop Verifier",
        experience: 1_500_000,
        statisticTotalMonsterKills: 8_100,
        season: 10,
        hardcore: 0,
        bloodPact: 0,
        seasonMode: "GSS",
      },
      {
        message: "SERVER: [Softcore] E2E Drop Verifier just found [Fumacinha's Favela Flipflop]",
      },
      {
        message: "SERVER: [Softcore] E2E Drop Verifier just found [Aurelion Fury]",
      },
    ])} rare-tail`,
  ];
}

function e2ePastRuns() {
  const endedAt = Date.now() - 60_000;
  return [
    {
      id: "e2e-run-alpha",
      sessionStartedAt: endedAt - 1_800_000,
      sessionEndedAt: endedAt,
      durationMs: 1_800_000,
      accountName: "E2E Paladin",
      tags: ["farming"],
      totalGoldGained: 125_000,
      totalXpGained: 2_500_000,
      totalKillsGained: 420,
      setDrops: 1,
      satanicDrops: 2,
      heroicDrops: 0,
      angelicDrops: 1,
      itemBreakdown: {
        Set: { "E2E Guard": { name: "E2E Guard", total: 1, mf: 0 } },
        Satanic: { "E2E Crown": { name: "E2E Crown", total: 2, mf: 1 } },
        Heroic: {},
        Angelic: { "E2E Angelic Blade": { name: "E2E Angelic Blade", total: 1, mf: 1 } },
      },
      keys: [{ id: 7, name: "Ruby Key", total: 2 }],
      ores: [{ id: 27, name: "Copper Ore", total: 9 }],
      materials: [{ id: 13, name: "E2E Dust", total: 5 }],
    },
    {
      id: "e2e-run-beta",
      sessionStartedAt: endedAt - 4_000_000,
      sessionEndedAt: endedAt - 3_600_000,
      durationMs: 400_000,
      accountName: "E2E Nomad",
      tags: ["keys"],
      totalGoldGained: 15_000,
      totalXpGained: 250_000,
      totalKillsGained: 80,
      setDrops: 0,
      satanicDrops: 1,
      heroicDrops: 1,
      angelicDrops: 0,
      itemBreakdown: {
        Set: {},
        Satanic: { "E2E Relic": { name: "E2E Relic", total: 1, mf: 0 } },
        Heroic: { "E2E Torch": { name: "E2E Torch", total: 1, mf: 0 } },
        Angelic: {},
      },
      keys: [],
      ores: [],
      materials: [],
    },
  ];
}

module.exports = {
  e2eCaptureEvents,
  e2ePastRuns,
  e2eRareDropTrafficPayloads,
  e2eTrafficPayloads,
};
