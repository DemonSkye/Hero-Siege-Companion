# Market

The Market tab replaces the Live shopping list with saved item searches. Choose a
catalog item, add optional minimum sockets and stat minimums, then press Search.
Save item and filters to keep the search locally. Loading a saved item fills the
editor; it does not send a request. Save changes updates that entry, Save as new
creates a separate entry, and Delete offers Undo.

The dropped-item Timeline Market action opens the same saveable catalog target
as the picker. Normal/unique drops keep their mask and drop display; runeword
Timeline IDs are interpreted as native repository IDs and open the canonical
runeword definition. Legacy constructor-case aliases apply to saved storage only.
Opening a Timeline item clears old prices, starts a fresh draft, and preserves
existing saved entries, pending-search guards and cooldown. It never fetches
prices until Search is pressed. Unknown targets have no fallback mask.
This route starts from already-classified drops. Native compact-packet runeword
classification is not established by the reconstructed Timeline event tests.

Existing shopping-list names migrate on first load. Names without one supported
catalog identity remain visible: load the entry, choose its item, and save the
repair. Original shopping-list strings remain in preferences as a rollback archive.
Schema 3 saved entries are authoritative after migration, including an empty array.
Backups include saved filters; older backups migrate their shopping-list names.
Saving failures show a retry action while the draft stays open.

All 2,035 retained identities are discoverable: 956 normal, 979 unique and
100 runewords. Of the 24 formerly unnamed identities, 23 are constructor
`deprecated` placeholders and remain labeled deprecated; the other retains the
exact untranslated key `w_throwing_darkmoon_deck`. Current availability is unverified.
Runewords use the proved `filter_runeword` repository IDs 1–100, with an empty
normal/unique mask list. The old 0–99 constructor cases map through a permutation,
not a +1 offset. Codex entries keep their native IDs and type. Clearing or choosing
a normal item omits the optional runeword field; neither 0 nor -1 is sent.
Old runeword keys migrate through aliases to an explicit repository-ID namespace,
preserving saved names and criteria. This native construction evidence does not
prove present server matching or current-build parity.
Saved criteria are durable independently of the current encoder for every known
item. Older request-only entries recover their criteria from a validated request.
Loading prefers those criteria and lets the current encoder construct the draft;
a future catalog/selector migration must preserve them rather than discard them.

The accessible Market ready / Market not ready indicator describes local
prerequisites; it does not prove that authentication will be accepted. When Market
is not ready, the guidance is: “With capture running, search for an item in the game’s
Market or perform an in-game vote reset to collect the information needed.”
This refers to an action inside Hero Siege; active Companion SZ Refresh remains
disabled. First-search region preparation and region failures have separate
guidance. Search success, empty results, request rejection and transport failure
are separate outcomes; persistent checksum rejection has no established automatic
recovery. Searches are explicit, one request at a time, subject to the existing
cooldown. Filters are editable while waiting or after a failed request.

Price results show up to 20 gold-price listings from the first page and do not
represent the whole market. Price per unit appears when reliably decoded. The decoded
page-row count and server-returned count stay distinct from the displayed count.
Item-priced or unreadable rows may be omitted. The old compact price summary, if
reused, still displays only its lowest two cards.
Matching relies on the server. Unsupported game filter operators are not exposed.
No automated purchase, polling, alert or pagination runs from saved entries.

The stat picker exposes 383 evidenced IDs: the original 167 native Market
menu entries and 216 additional entries suffixed `(experimental)`. Exact names,
qualified role captions and unresolved `Stat N` names stay distinct. Search by
name or `Stat N` to find an ID after a label changes. These are grounded keys from
the retained native menu, text bindings, tooltip controls and constructor setters;
they are not a complete game enum or proof that the server honors every clause.
Unknown labels, unproved shapes or unproved server matching do not block an
approved experimental numeric clause. Off-menu fields that are tables on the
selected item are disabled only in that item context. Mixed scalar/table IDs
retain their distinct shapes; tables are never flattened into a minimum.
Native menu controls remain available, including Singular Skills (202), whose
separate selected-talent use does not remove its original native minimum control.
Saved unsupported criteria remain editable and durable, show actionable guidance,
and block dispatch until removed. Shape validation for storage stays separate from
wire validation in renderer, main and the actual builder. Arbitrary IDs remain rejected.
Six exact English item-stat joins add physical damage taken as Cold/Fire/Arcane/
Lightning, Flask Skill Haste and Increased Experience Gain Below Level 100.
Character-attribute IDs are a different namespace and are not joined.
The validated tooltip bindings add 115 exact English fragments, including
Loot Amount increased by, Rune Drop Chances Increased by and Maximum Weapon
Damage Increased by. Frozen v8 evidence adds 13 exact names and resolves roles
for 69 of the preceding 84 meaning gaps. Catalog metadata has 310 exact or
previously scoped names and 73 numeric fallbacks; role captions are separate
from native names. Fifteen meanings remain unresolved and experimental: 0, 1,
2, 10, 11, 12, 13, 14, 15, 24, 280, 295, 376, 378 and 473. Absence of a name
does not establish absence of a player-visible label or a reserved field.

The seven proc families distinguish talent identifiers from numeric levels and
chances. Cloak fields 117 (12–20) and 118 (3–6), for example, remain numeric
minimums; 116 selects the talent. Chance scales remain unchanged. Flask Effect
Duration (390) displays seconds; mana/life recovery fields have qualified input
captions rather than a claim to reconstruct the complete calculation.
In total, 345 IDs permit a generic minimum before selected-item table restrictions:
167 native and 178 experimental. The 38 exclusions comprise 19 experimental
talent identifiers, eight class identifiers, seven effect-presence fields, one
conditional marker, one categorical dispatch field, one zone collection and the
separate socket control. Exact-identity and presence wire controls are unproved;
the UI explains the incompatible role without inventing operators. Conditional
effects and markers do not display numeric roll bounds. Retained encoded contexts
remain identified as encoded. The 99 additional table restrictions across 97
items preserve their item context, while the 79 native controls on table-valued
definitions remain available.

Catalog base ranges sit beside the filters on wide layouts and above the saved
name on narrow layouts. The compact bordered card shows static base definitions
from build 24868792 / version 7.0.0.0, with experimental/current-build-parity copy.
All identities have explicit records; 1,636 have retained values, totaling 9,584
fields: 5,497 ranges, 3,907 scalars, 178 native tables and two dynamic tablet-zone
values. Tables are shown as tables, and dynamic values have descriptions rather
than invented bounds. Four unconditional repeated setters keep the later value.
Records without numeric values say none were retained, not that the item has no
possible stats. These counts cover recognized constructor setters, not generated
affixes, tier/context calculations, final tooltips or current installed-game parity.

Verified listing-roll reconstruction remains limited to the two independently
observed shield definitions. Tiny Planet retains its 15-25% Orbital Projectile
Duration base range and separate Orbital Gravity set bonus; listing rolls remain
withheld until a same-specimen compact record and independent tooltip validate
them. Broad static definitions do not confer listing-roll verification.

Results place variant and stat information beside prices. Identified, supported
unmodified listings show their reconstructed rolls; other definitions, modified
variants and unidentified items have explicit unknown/hidden states. Base defense
and block values stay labeled as base values rather than claiming full tooltip
arithmetic. Main discards compact seeds, hashes, fingerprints and seller data
before IPC. Result limits are collapsed below the table, with fetch/cache time
last. Loading/saving filters still never fetches results.

## Owners and verification

- `lib/market-items.ts`: common picker/Timeline target resolution and reversible legacy migration.
- `lib/saved-market-items.ts`: saved request validation, load/edit/save/delete/undo.
- `lib/preferences.ts` and `lib/app-preferences.ts`: schema 3 local/backup durability.
- `lib/market-search-runtime.ts`: shared draft validation, explicit search, cooldown,
  response states and stale reply suppression.
- `components/MarketView.vue` and `styles/market.css`: tab workspace and keyboard/focus
  behavior. App coordinates navigation and typed preload calls.
- `components/MarketReadinessStatus.vue`, `lib/market-readiness-display.ts` and
  `styles/market-search.css`: accessible status light/text and missing-context
  guidance; transport eligibility remains in the existing main/shared owners.
- `main/captured-session-context.ts`: safe numeric readiness context version;
  identity/mode/session changes clear prices, while same-account region preparation
  preserves the first explicit search. No sensitive identity crosses this projection.
- Existing main provider/worker/reducer own authentication, HTTPS, limits and safe
  result reduction. Checksum/signature formulas remain unchanged.
- `main/market-search-handler.ts`: request validation and an allowlisted, bounded
  response for the preload IPC capability, including safe error/timing metadata.
- `main/market-listing-projection.ts`, `shared/market-listing-item.ts` and
  `shared/item-stat-ranges.ts`: bounded main-only reconstruction, safe listing
  contract and the two verified definition/roll mappings.
- `shared/item-base-stat-catalog.ts` and its versioned data: sanitized static
  constructor facts, separate from listing reconstruction. Raw source, operands
  and extraction receipts remain private workspace evidence.
- `shared/market-search.ts`: native and experimental stat discovery, separate
  durable/wire validation, proven normal/unique masks and exclusive native targets.
- `shared/market-stat-capabilities.ts` and its versioned role data: qualified
  field semantics, unsupported role controls and selected-item encoded contexts.
- `shared/runeword-market-catalog.ts`: versioned native selector permutation and
  reversible legacy-key aliases; no invented masks.
- `components/MarketListingDetails.vue`: variant/roll display with honest unknown
  and unidentified states.

Run focused Market specs in `tests/main` and `tests/renderer`, then the offline suite,
typecheck and builds. `tests/e2e/electron-market-saved-filters.spec.cjs`, the mainline
Market journey and the preload suite
exercise actual Electron wiring with synthetic capture/network boundaries.
`tests/fixtures/market.ts` labels reconstructed public shapes and invented sensitive
values. `market-accepted-transformed.json` retains all 101 prices from an accepted
Companion response; its credentials and endpoint are substituted. Worker entry,
composed runtime and real Electron restart checks reuse this projection with an
independent 20-price expectation. The response body and request oracle are unchanged.
These offline checks do not establish fresh native or server acceptance.
`market-listing-items.json` labels retained accepted-response rows separately from
synthetic listing rows derived from compact links and observed tooltip values.
Worker-entry, reducer/IPC/cache/UI and responsive Electron checks retain production
glue while replacing external transport. Their expected tooltip values are
independent of the reconstruction code.
`item-base-stat-catalog.spec.ts` uses literal operand expectations across item
categories, later-setter regressions and distinct table/dynamic states.
`market-grounded-stat-ids.ts` freezes the expected ID set without production
imports. Real-App and Electron checks cover offline cloak ranges, experimental
filter saving/search, all 100 native selectors, old pending runeword criteria,
metadata rejection before transport, repair, persistence and restart.
`electron-market-timeline-targets.spec.cjs` carries reconstructed parsed drops
through StatsEngine, preload, Timeline, LiveView and App into saveable normal and
native runeword targets, explicit IPC searches, cooldown and process restart.
It does not establish native packet runeword classification; that producer path
remains a separate compatibility boundary. The v6 label fixture preserves all
115 literal joins without production imports. Independent v8 fixtures keep the
seven proc tuples, 13 exact labels, class/talent roles, 15 remaining meaning gaps
and 38 current exclusions literal. Actual worker-entry checks compare serialized
numeric clauses with independent expected values. The v8 Electron journey keeps
an older unsupported talent criterion durable across restart, then repairs it
into an explicit Cloak quantity search through real preload/main wiring.
