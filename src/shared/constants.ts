export const CURRENT_SEASON = 10;

export const ITEM_RARITY: Record<string, string> = {
  "1": "Common",
  "2": "Superior",
  "3": "Rare",
  "4": "Set",
  "5": "Mythic",
  "6": "Satanic",
  "9": "Heroic",
  "7": "Angelic",
  "8": "Blessed",
  "10": "Unholy",
};

export const ITEM_TYPE_NAMES: Record<number, string> = {
  0: "Helmet",
  1: "Chest",
  2: "Boots",
  3: "Weapon",
  4: "Gloves",
  5: "Amulet",
  6: "Shield",
  7: "Ring",
  8: "Belt",
  10: "Charm",
  11: "Consumable",
  12: "Key",
  13: "Collectible",
  14: "Material",
  15: "Socketable",
  18: "Vial",
};

export const MATERIAL_LIKE_TIMELINE_TYPES = new Set([13, 14]);

export const WEAPON_TYPE_NAMES: Record<number, string> = {
  0: "Item",
  1: "Sword",
  2: "Dagger",
  3: "Mace",
  4: "Axe",
  5: "Claw",
  6: "Polearm",
  7: "Chainsaw",
  8: "Staff",
  9: "Cane",
  10: "Wand",
  11: "Book",
  12: "Spellblade",
  13: "Bow",
  14: "Gun",
  15: "Flask",
  16: "Throwing",
  17: "Novelty",
};

export const SATANIC_BUFFS: Record<string, string> = {
  "Loot Goblin I": "+1 Maximum Loot from Enemy Killed",
  "Loot Goblin II": "+2 Maximum Loot from Enemy Killed",
  "Rune Master": "15% + (2.5% per sub difficulty level) Increased Rune Drop Chance",
  "Gold Hunger": "Gold from monster kills increased by 40% + (8.75% per sub difficulty level)",
  "Heroic Windfall": "Heroic Item drop chances increased by 3% + (3% per sub difficulty level)",
  "Angelic Fortune": "Angelic Item drop chances increased by 25% + (7.5% per sub difficulty level)",
  "Zephys Grace": "Movement Speed increased by 50%",
  "Fury of Tempest": "Attack Speed increased by 60%",
  "Rapid Casting": "Faster Cast Rate increased by 60%",
  Onslaught: "Attack Damage increased by 100%",
  "Nether Surge": "Magic Skill Damage increased by 40%",
  "Relic Keepers": "Ancient monsters have a 2% chance to drop a relic on death",
  "Goblin's Greed": "Champion+ monsters have a 0.5% chance to summon a Treasure Goblin on death",
  "Artifact Digger": "+55% Magic Find + (5% per sub difficulty level)",
  "Artifact Seeker": "+110% Magic Find + (10% per sub difficulty level)",
  "Artifact Excavator": "+170% Magic Find + (20% per sub difficulty level)",
  Recruit: "+10% Experience Gain + (2.5% per sub difficulty level)",
  "Combat Training": "+15% Experience Gain + (3.75% per sub difficulty level)",
  "Battle Scarred": "+20% Experience Gain + (5% per sub difficulty level)",
  Clairvoyance: "All recovery increased by 100% (Mana per hit, Life per hit, Mana and Life Replenish, etc.)",
  Aftermath: "Monsters have a 3% chance to summon a Legion version of them on death",
  "Deep Cuts": "Critical Strike damage increased by 200%",
  "Old Town": "+15% chance for Ancient Packs",
  "Terror Zone": "+25% chance for Ancient Packs",
  "Fields of Carnage": "+30% chance for Ancient Packs",
};

export const SATANIC_DEBUFFS: Record<string, string> = {
  "Dusk's Shroud": "Light Radius decreased by 20%",
  "Elemental Erosion": "All Resistances decreased by 75%",
  "Vitality Drain": "Life decreased by 25%",
  "Essence Drain": "Mana decreased by 25%",
  "Abyssal Gloom": "Darkness increased by 100%",
  "Skill Debilitation": "All Skills decreased by 10%",
  "Weakening Essence": "All Attributes decreased by 20%",
  "Sanguine Impairment": "Life Steal decreased by 75%",
  "Arcane Impairment": "Mana Steal decreased by 75%",
  "Sundered Armor": "Damage Taken increased by 25%",
  "Consumed Time": "Cooldown Recovery decreased by 25%",
  "Absolute Limbo": "Cooldown Recovery decreased by 50%",
  "Boulder Fall": "Monsters have a 3% chance to drop a boulder from the sky on death",
  "Lingering Evil": "Movement Speed reduced by 25%",
  "Fatal Wounds": "Monsters gain a 10% chance to inflict 2x damage",
  "Bloated Veins": "Monsters have 70% increased Life",
  "Abnormal Dwelling": "Monsters have 130% increased Life",
  "Colossal Bloating": "Monsters have 200% increased Life",
  Necrosis: "Your life is drained by 1% every second",
  "Venomous Presence": "Poison Duration is increased by 200%",
  "Flaming Agony": "Monsters unleash a Fire Nova on death dealing 50% of their damage",
  "Unholy Agility": "Monsters gain increased movement and attack speed",
  "Broken Armor": "You are unable to block attacks and projectiles",
  Hemorrhage: "Monster attacks inflict a 4 second stacking bleed for 10% of their damage",
  "Crippling Slow": "Monster attacks inflict a 50% slow that lasts 2 seconds",
};

export const SATANIC_DEBUFF_ID_OVERRIDES: Record<number, string> = {
  1: "Dusk's Shroud",
};

export const SATANIC_ZONE_NAMES: Record<number, string[]> = {
  1: ["Outskirts of Inoya", "Field of Battle", "The Pumpkin Patch", "Woodhill Plains", "King's Garden"],
  2: ["Crystal Village", "Chilling Lake", "Arctic Tundra", "Snowy Mountains", "The Glacial Trail"],
  3: ["Corrupted Oasis", "Dry Hills", "Mos'Arthim Desert", "Pyramid Level 1", "Pyramid Level 2"],
  4: ["Old Mining Village", "The Highland Mines", "Corrupted Cave", "The Nightmare", "The Devil's Breach"],
  5: ["Mt. Fuji", "Misty Swamp", "Fuji Coast", "Sea of Karponia", "Temple of Zamjo"],
  6: ["Highland Graveyard", "The Cathedral", "Prison Dungeon", "Steam Train", "The Depths of Hell"],
  7: ["Deep Space", "Event Horizon", "The Black Hole", "Parallel Dimension", "Subconscious Mind"],
  8: ["Forest of the Slain", "Flooded Plains", "Forgotten Caves", "Camp of Souls", "Hellheim"],
};

export const EVENT_NAMES = {
  gold: "updateGold",
  xp: "updateXP",
  account: "updateAccount",
  accountMode: "updateAccountMode",
  mail: "updateMail",
  item: "itemAdded",
  itemDrop: "itemDropped",
  satanicZone: "updateSatanicZone",
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];
