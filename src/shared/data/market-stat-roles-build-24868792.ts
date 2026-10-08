// Sanitized frozen v8 item-field roles. Qualified captions are not universal native labels.
// Field classification SHA256: 9f2595a5eb1152e0526ebc0117da3620f19f6bc57e9e73d17b44e3c78cd7f7af
export interface MarketStatRoleDefinition {
  statId: number;
  kind: "quantity" | "class-identifier" | "talent-identifier" | "effect" | "marker" | "categorical" | "collection" | "control-only";
  caption?: string;
  detail: string;
  talentFieldId?: number;
}
export const MARKET_STAT_ROLES_V8: readonly MarketStatRoleDefinition[] = [
  {
    "statId": 21,
    "kind": "class-identifier",
    "caption": "Class identifier (Stat 21)",
    "detail": "Categorical class selector; this is not a numeric quantity."
  },
  {
    "statId": 22,
    "kind": "control-only",
    "detail": "Participates in the Attack Damage calculation; the complete displayed amount is not established."
  },
  {
    "statId": 23,
    "kind": "control-only",
    "detail": "Participates in the Attacks per Second calculation; the complete displayed amount is not established."
  },
  {
    "statId": 102,
    "kind": "effect",
    "detail": "Conditional effect presence; this is not a roll quantity."
  },
  {
    "statId": 113,
    "kind": "talent-identifier",
    "caption": "Talent identifier when attacking (Stat 113)",
    "detail": "Proc talent selector; a greater-than comparison would select the wrong identity."
  },
  {
    "statId": 114,
    "kind": "quantity",
    "caption": "Talent level when attacking (Stat 114)",
    "detail": "Numeric proc level; selected-item tables remain tables."
  },
  {
    "statId": 115,
    "kind": "quantity",
    "caption": "Talent chance when attacking (Stat 115)",
    "detail": "Numeric proc chance in its retained scale; no percent conversion is inferred."
  },
  {
    "statId": 116,
    "kind": "talent-identifier",
    "caption": "Talent identifier when striking (Stat 116)",
    "detail": "Proc talent selector; a greater-than comparison would select the wrong identity."
  },
  {
    "statId": 117,
    "kind": "quantity",
    "caption": "Talent level when striking (Stat 117)",
    "detail": "Numeric proc level; selected-item tables remain tables."
  },
  {
    "statId": 118,
    "kind": "quantity",
    "caption": "Talent chance when striking (Stat 118)",
    "detail": "Numeric proc chance in its retained scale; no percent conversion is inferred."
  },
  {
    "statId": 119,
    "kind": "talent-identifier",
    "caption": "Talent identifier on spell hit (Stat 119)",
    "detail": "Proc talent selector; a greater-than comparison would select the wrong identity."
  },
  {
    "statId": 120,
    "kind": "quantity",
    "caption": "Talent level on spell hit (Stat 120)",
    "detail": "Numeric proc level; selected-item tables remain tables."
  },
  {
    "statId": 121,
    "kind": "quantity",
    "caption": "Talent chance on spell hit (Stat 121)",
    "detail": "Numeric proc chance in its retained scale; no percent conversion is inferred."
  },
  {
    "statId": 122,
    "kind": "talent-identifier",
    "caption": "Talent identifier when killing (Stat 122)",
    "detail": "Proc talent selector; a greater-than comparison would select the wrong identity."
  },
  {
    "statId": 123,
    "kind": "quantity",
    "caption": "Talent level when killing (Stat 123)",
    "detail": "Numeric proc level; selected-item tables remain tables."
  },
  {
    "statId": 124,
    "kind": "quantity",
    "caption": "Talent chance when killing (Stat 124)",
    "detail": "Numeric proc chance in its retained scale; no percent conversion is inferred."
  },
  {
    "statId": 125,
    "kind": "talent-identifier",
    "caption": "Talent identifier when casting (Stat 125)",
    "detail": "Proc talent selector; a greater-than comparison would select the wrong identity."
  },
  {
    "statId": 126,
    "kind": "quantity",
    "caption": "Talent level when casting (Stat 126)",
    "detail": "Numeric proc level; selected-item tables remain tables."
  },
  {
    "statId": 127,
    "kind": "quantity",
    "caption": "Talent chance when casting (Stat 127)",
    "detail": "Numeric proc chance in its retained scale; no percent conversion is inferred."
  },
  {
    "statId": 185,
    "kind": "talent-identifier",
    "caption": "Talent identifier when struck (Stat 185)",
    "detail": "Proc talent selector; a greater-than comparison would select the wrong identity."
  },
  {
    "statId": 186,
    "kind": "quantity",
    "caption": "Talent level when struck (Stat 186)",
    "detail": "Numeric proc level; selected-item tables remain tables."
  },
  {
    "statId": 187,
    "kind": "quantity",
    "caption": "Talent chance when struck (Stat 187)",
    "detail": "Numeric proc chance in its retained scale; no percent conversion is inferred."
  },
  {
    "statId": 188,
    "kind": "talent-identifier",
    "caption": "Talent identifier when blocking (Stat 188)",
    "detail": "Proc talent selector; a greater-than comparison would select the wrong identity."
  },
  {
    "statId": 189,
    "kind": "quantity",
    "caption": "Talent level when blocking (Stat 189)",
    "detail": "Numeric proc level; selected-item tables remain tables."
  },
  {
    "statId": 190,
    "kind": "quantity",
    "caption": "Talent chance when blocking (Stat 190)",
    "detail": "Numeric proc chance in its retained scale; no percent conversion is inferred."
  },
  {
    "statId": 202,
    "kind": "talent-identifier",
    "caption": "Talent identifier (Stat 202)",
    "detail": "Selects a talent identity; this is not a numeric quantity."
  },
  {
    "statId": 203,
    "kind": "quantity",
    "caption": "Selected talent modifier (Stat 203)",
    "talentFieldId": 202,
    "detail": "Numeric modifier for the talent selected by field 202; class and table context remain separate."
  },
  {
    "statId": 204,
    "kind": "class-identifier",
    "caption": "Class identifier (Stat 204)",
    "detail": "Categorical class selector; this is not a numeric quantity."
  },
  {
    "statId": 205,
    "kind": "talent-identifier",
    "caption": "Talent identifier (Stat 205)",
    "detail": "Selects a talent identity; this is not a numeric quantity."
  },
  {
    "statId": 206,
    "kind": "quantity",
    "caption": "Selected talent modifier (Stat 206)",
    "talentFieldId": 205,
    "detail": "Numeric modifier for the talent selected by field 205; class and table context remain separate."
  },
  {
    "statId": 207,
    "kind": "class-identifier",
    "caption": "Class identifier (Stat 207)",
    "detail": "Categorical class selector; this is not a numeric quantity."
  },
  {
    "statId": 208,
    "kind": "talent-identifier",
    "caption": "Talent identifier (Stat 208)",
    "detail": "Selects a talent identity; this is not a numeric quantity."
  },
  {
    "statId": 209,
    "kind": "quantity",
    "caption": "Selected talent modifier (Stat 209)",
    "talentFieldId": 208,
    "detail": "Numeric modifier for the talent selected by field 208; class and table context remain separate."
  },
  {
    "statId": 210,
    "kind": "class-identifier",
    "caption": "Class identifier (Stat 210)",
    "detail": "Categorical class selector; this is not a numeric quantity."
  },
  {
    "statId": 211,
    "kind": "talent-identifier",
    "caption": "Talent identifier (Stat 211)",
    "detail": "Selects a talent identity; this is not a numeric quantity."
  },
  {
    "statId": 212,
    "kind": "quantity",
    "caption": "Selected talent modifier (Stat 212)",
    "talentFieldId": 211,
    "detail": "Numeric modifier for the talent selected by field 211; class and table context remain separate."
  },
  {
    "statId": 213,
    "kind": "class-identifier",
    "caption": "Class identifier (Stat 213)",
    "detail": "Categorical class selector; this is not a numeric quantity."
  },
  {
    "statId": 214,
    "kind": "talent-identifier",
    "caption": "Talent identifier (Stat 214)",
    "detail": "Selects a talent identity; this is not a numeric quantity."
  },
  {
    "statId": 215,
    "kind": "quantity",
    "caption": "Selected talent modifier (Stat 215)",
    "talentFieldId": 214,
    "detail": "Numeric modifier for the talent selected by field 214; class and table context remain separate."
  },
  {
    "statId": 216,
    "kind": "class-identifier",
    "caption": "Class identifier (Stat 216)",
    "detail": "Categorical class selector; this is not a numeric quantity."
  },
  {
    "statId": 217,
    "kind": "talent-identifier",
    "caption": "Talent identifier (Stat 217)",
    "detail": "Selects a talent identity; this is not a numeric quantity."
  },
  {
    "statId": 218,
    "kind": "quantity",
    "caption": "Selected talent modifier (Stat 218)",
    "talentFieldId": 217,
    "detail": "Numeric modifier for the talent selected by field 217; class and table context remain separate."
  },
  {
    "statId": 219,
    "kind": "class-identifier",
    "caption": "Class identifier (Stat 219)",
    "detail": "Categorical class selector; this is not a numeric quantity."
  },
  {
    "statId": 221,
    "kind": "marker",
    "detail": "Conditional marker with scalar/array paths; no displayed scalar amount is established."
  },
  {
    "statId": 279,
    "kind": "quantity",
    "detail": "Retained numeric quantity; its native scale is preserved."
  },
  {
    "statId": 291,
    "kind": "effect",
    "detail": "Conditional effect presence; this is not a roll quantity."
  },
  {
    "statId": 292,
    "kind": "effect",
    "detail": "Conditional effect presence; this is not a roll quantity."
  },
  {
    "statId": 293,
    "kind": "effect",
    "detail": "Conditional effect presence; this is not a roll quantity."
  },
  {
    "statId": 315,
    "kind": "talent-identifier",
    "caption": "Talent identifier (Stat 315)",
    "detail": "Selects a talent identity; this is not a numeric quantity."
  },
  {
    "statId": 316,
    "kind": "quantity",
    "caption": "Selected talent level (Stat 316)",
    "detail": "Numeric level for the selected talent; identifier remains a separate field."
  },
  {
    "statId": 319,
    "kind": "talent-identifier",
    "caption": "Talent identifier (Stat 319)",
    "detail": "Selects a talent identity; this is not a numeric quantity."
  },
  {
    "statId": 320,
    "kind": "quantity",
    "caption": "Selected talent level (Stat 320)",
    "detail": "Numeric level for the selected talent; identifier remains a separate field."
  },
  {
    "statId": 321,
    "kind": "talent-identifier",
    "caption": "Talent identifier (Stat 321)",
    "detail": "Selects a talent identity; this is not a numeric quantity."
  },
  {
    "statId": 322,
    "kind": "quantity",
    "caption": "Selected talent level (Stat 322)",
    "detail": "Numeric level for the selected talent; identifier remains a separate field."
  },
  {
    "statId": 323,
    "kind": "talent-identifier",
    "caption": "Talent identifier (Stat 323)",
    "detail": "Selects a talent identity; this is not a numeric quantity."
  },
  {
    "statId": 324,
    "kind": "quantity",
    "caption": "Selected talent level (Stat 324)",
    "detail": "Numeric level for the selected talent; identifier remains a separate field."
  },
  {
    "statId": 325,
    "kind": "talent-identifier",
    "caption": "Talent identifier (Stat 325)",
    "detail": "Selects a talent identity; this is not a numeric quantity."
  },
  {
    "statId": 326,
    "kind": "quantity",
    "caption": "Selected talent level (Stat 326)",
    "detail": "Numeric level for the selected talent; identifier remains a separate field."
  },
  {
    "statId": 347,
    "kind": "collection",
    "detail": "Collection of zones, not a numeric minimum."
  },
  {
    "statId": 348,
    "kind": "quantity",
    "detail": "Retained numeric quantity; its native scale is preserved."
  },
  {
    "statId": 349,
    "kind": "categorical",
    "caption": "Dispatch category (Stat 349)",
    "detail": "Categorical cases in the Codex path; exact category names remain unresolved."
  },
  {
    "statId": 384,
    "kind": "quantity",
    "caption": "Mana recovery input (Stat 384)",
    "detail": "Numeric flask recovery input; complete recovery calculation is not reconstructed."
  },
  {
    "statId": 387,
    "kind": "quantity",
    "caption": "Life recovery input (Stat 387)",
    "detail": "Numeric flask recovery input; complete recovery calculation is not reconstructed."
  },
  {
    "statId": 390,
    "kind": "quantity",
    "detail": "Flask effect duration in seconds."
  },
  {
    "statId": 413,
    "kind": "quantity",
    "detail": "Retained numeric quantity; its native scale is preserved."
  },
  {
    "statId": 414,
    "kind": "quantity",
    "detail": "Retained numeric quantity; its native scale is preserved."
  },
  {
    "statId": 415,
    "kind": "effect",
    "detail": "Conditional effect presence; this is not a roll quantity."
  },
  {
    "statId": 416,
    "kind": "effect",
    "detail": "Conditional effect presence; this is not a roll quantity."
  },
  {
    "statId": 418,
    "kind": "effect",
    "detail": "Conditional effect presence; this is not a roll quantity."
  },
  {
    "statId": 420,
    "kind": "quantity",
    "caption": "Sub-skill modifier (Stat 420)",
    "detail": "Numeric modifier in the selected sub-skill context; no unit conversion is inferred."
  },
  {
    "statId": 444,
    "kind": "talent-identifier",
    "caption": "Talent identifier (Stat 444)",
    "detail": "Selects a talent identity; this is not a numeric quantity."
  },
  {
    "statId": 445,
    "kind": "quantity",
    "caption": "Selected talent modifier (Stat 445)",
    "talentFieldId": 444,
    "detail": "Numeric modifier for the talent selected by field 444; class and table context remain separate."
  },
  {
    "statId": 462,
    "kind": "talent-identifier",
    "caption": "Talent identifier (Stat 462)",
    "detail": "Selects a talent identity; this is not a numeric quantity."
  },
  {
    "statId": 463,
    "kind": "quantity",
    "caption": "Selected talent modifier (Stat 463)",
    "talentFieldId": 462,
    "detail": "Numeric modifier for the talent selected by field 462; class and table context remain separate."
  },
  {
    "statId": 464,
    "kind": "class-identifier",
    "caption": "Class identifier (Stat 464)",
    "detail": "Categorical class selector; this is not a numeric quantity."
  }
];
export const MARKET_PROC_FAMILIES_V8 = [
  {
    "eventKey": "when_kill",
    "skillIdentifierId": 122,
    "levelId": 123,
    "chanceId": 124
  },
  {
    "eventKey": "when_strike",
    "skillIdentifierId": 116,
    "levelId": 117,
    "chanceId": 118
  },
  {
    "eventKey": "when_spellhit",
    "skillIdentifierId": 119,
    "levelId": 120,
    "chanceId": 121
  },
  {
    "eventKey": "when_struck",
    "skillIdentifierId": 185,
    "levelId": 186,
    "chanceId": 187
  },
  {
    "eventKey": "when_blocking",
    "skillIdentifierId": 188,
    "levelId": 189,
    "chanceId": 190
  },
  {
    "eventKey": "when_casting",
    "skillIdentifierId": 125,
    "levelId": 126,
    "chanceId": 127
  },
  {
    "eventKey": "when_attacking",
    "skillIdentifierId": 113,
    "levelId": 114,
    "chanceId": 115
  }
] as const;
