# Reusable item data

The canonical, language-neutral sources are in
[`src/shared/data/items/build-24868792`](../src/shared/data/items/build-24868792).
They reuse the catalog from dev commit `992c5da`. Small TypeScript adapters retain
the existing production APIs; item selectors, filters, stat display and the seed
decoder read these same facts. There is no second hand-maintained catalog.

| Source | Owns |
| --- | --- |
| `identities.json` | Repository/type/subtype/game ordinal, fixed or seeded names, missing identities, constructor provenance and build hashes |
| `constructor-stats.json` | Ordered scalar, range, table and dynamic constructor values keyed by item identity |
| `item-stats.json` | One shared numeric stat-ID catalog: labels, units, native menu membership, qualified roles, meaning gaps, encoded contexts and proc families |
| `rarities.json` | Inherited normalized-name classification and its distinct provenance |
| `runewords.json` | External runeword repository IDs mapped to legacy constructor keys; tuples are `[externalId, legacyKey, itemTypeOrNull]`. Names derive from `identities.json`. |
| `listing-coverage.json` | Unaudited constructor helper gaps and optional-generation guards |

`item-stats.ts` exports `ItemStats` and `itemStat(id)`. Numeric `statId` is the
stable identity; a display name is not an enum member or a reliable join key.
`items.ts` exports `Items.base`, `Items.satanic`, `Items.set`, `Items.heroic`,
`Items.angelic`, and `Items.unholy`, each containing names and constructor stats.
`Items.unknown` and `Items.runeword` preserve entries outside those groups.

## Example

```ts
import { Items } from "./src/shared/items";
import { itemStat } from "./src/shared/item-stats";

const glove = Items.heroic.find(item => item.itemKey === "unique:4:0:62");
for (const value of glove?.stats ?? []) {
  const metadata = itemStat(value.statId);
  console.log(value.statId, metadata?.name, metadata?.unit, value);
}
// Stat 31 remains a scalar: minimum = maximum = 0.5.
```

For other languages, read the JSON directly, or produce a grouped JSON view:

```sh
npm run catalog:check
npm run catalog:export
```

The exporter compiles shared consumers, validates the source data, then writes
`out/item-data/items.json` and `out/item-data/item-stats.json`. It performs no
network or game I/O. Output ordering and serialization are deterministic; `out/`
is ignored. Edit the canonical JSON, not the exported files. The grouped view is
generated from the same `Items` projection used by TypeScript contributors.

## Identities and classification

Normal and unique keys are `repository:type:weaponType:gameId`; the serialized
`b` ordinal is `gameId`, and a weapon subtype belongs in the key. Do not merge
same-name entries or normal and unique definitions. For runewords, `catalogKey`
retains the legacy constructor ordinal while `itemKey` is
`runeword-repository:externalId`. These numeric domains are permuted, not
interchangeable. Keep both keys and the binding table. The view's `type`,
`weaponType` and `gameId` always retain the **legacy catalog coordinates**;
runewords remain type 3/subtype 0 even for a helmet, boots or a Codex.
The separate `itemType` carries the resolved binding type for runewords: 0 for
Delirium Tremens, 2 for Quickstep and 11 for seven entries including Spelunker.
The other 91 runeword `itemType` values are explicitly `null`. For normal and
unique entries, `itemType` equals `type`. Never substitute `itemType` into a
legacy catalog key or assume null means type 3.

`identities.json` owns all canonical item names, including every runeword name.
To correct a runeword name, edit its identity's `name` once. The grouped view,
Market selector and compatibility tuple derive that same name on the next build
or export. `runewords.json` owns only the ID permutation and nullable item type;
it has no separately editable label. Validation requires each binding to refer
to a named runeword identity. Intentional corrections still need evidence and
an updated reviewed semantic pin; generated outputs are not name sources.

`base` means the **normal repository**, including materials, socketables and
seeded base equipment. It is not a claim about a rolled item's quality/tier.
Seeded entries use `nameKind: "base"`; they do not supply an instance's generated
name. The five named rarity groups reuse the app's retained name table.
`classificationBasis` records that evidence; it is not a newly proved native
rarity/tier field. Missing or unclassified names stay in `unknown`. Names that
could not be translated are `null`, with their localization ID and reason kept.
Never infer a tier from an ordinal, stat value, item name fragment or repository.

| Group | Definitions | With retained constructor values |
| --- | ---: | ---: |
| base | 956 | 637 |
| satanic | 421 | 420 |
| set | 254 | 254 |
| heroic | 193 | 193 |
| angelic | 30 | 30 |
| unholy | 18 | 18 |
| runeword | 100 | 44 |
| unknown | 63 | 40 |

The 2,035 definitions include 2,011 resolved identities and 24 explicit missing
English names. `unknown` also contains 39 resolved names without a compatible
classification. Coverage is not a claim to include every current game item.

## Stat meaning and limits

The 383 grounded IDs include 167 retained native Market menu entries. Constructor
data has 9,584 fields on 1,636 definitions: 5,497 ranges, 3,907 scalars, 178 tables
and two dynamic values. Preserve field and table order, fractional numbers,
later-setter results and all numeric IDs.

- `scalar`: one value; minimum and maximum must match. Do not floor fractions.
- `range`: retained constructor bounds, not the rolled value of a listing.
- `series`: an ordered native value table; its extrema are not a roll range.
- `dynamic`: an explicitly described runtime value, such as tablet zones.

`statsComplete` only describes interpretation of recognized setters. Empty stats
with `statsStatus: "no-values-retained"` do not mean the item has no game stats.
Affix pools, conditional helpers, tiers, upgrades, corruption, socket contents,
final tooltip arithmetic and current-build parity remain outside this claim.
The existing main-only decoder and listing guards remain the owners of actual
roll reconstruction; constructor coverage does not grant listing eligibility.
The tier helper shared by item constructors is audited: it adds only nonrandom
metadata and, for some weapons, a scalar "Attacks can hit multiple enemies" value
equal to any constructor value, so it neither draws nor changes a listed field.
Only families with other unaudited constructor helpers keep a listing gap.

Units retain the existing scale. `unknown` does not mean flat or percent. Roles
distinguish quantities, class/talent identifiers, effects, markers, categories,
collections and control-only fields. Qualified role captions are not universal
English labels. A non-null role supersedes an older `unresolvedMeaning` entry,
as in Market; 15 fields still have unresolved meanings. IDs 119 and 121 have
proved roles but empty localization keys. Encoded meanings remain item-specific.
Do not borrow labels from the separate character-attribute ID domain or convert
proc chances into percentages without evidence.

## Contributing and validation

1. Locate the definition by its complete key, and inspect its provenance and
   missing/unknown state. Changes need a traceable, distributable evidence summary.
2. Edit the owning JSON source. Preserve identity domains, setter/table ordering,
   units, roles and explicit unknowns. A new build needs its own provenance and
   reviewed adapter activation; do not relabel this historical build as current.
3. Run `npm run catalog:check`, the affected tests, `npm run typecheck`, and
   `npm run build`. Run `npm run catalog:export` when a portable view is useful.

[`item-data.schema.json`](../src/shared/data/items/item-data.schema.json) is a
Draft 2020-12 schema. Each file has a named `$defs` entry; the CLI validates all
six sources together with Ajv, then checks ID uniqueness, joins, build/hash
coherence, bounds, table extrema, dynamic coverage and generation references.
The original item resolver additionally validates constructor/domain accounting
and fixed/seeded/missing/quarantined policy.

`tests/shared/item-data.spec.ts` pins complete semantic hashes of the original
dev tables, preserving array order while ignoring object formatting. An intentional
data correction must document its evidence and update the affected pin after
review; do not casually regenerate all pins. Consumer suites cover catalog search,
saved filters, display and seed generation independently of those hashes.

Only sanitized catalog facts and hashes belong here. Keep credentials, user data,
captures, raw responses, research binaries, addresses and private research paths
outside reusable data and app Git. No live access or fresh decompilation is needed
for this contribution workflow.
