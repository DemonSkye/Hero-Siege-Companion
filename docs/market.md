# Market

The Market tab replaces the Live shopping list with saved item searches. Choose a
catalog item, add optional minimum sockets and stat minimums, then press Search.
Save item and filters to keep the search locally. Loading a saved item fills the
editor; it does not send a request. Save changes updates that entry, Save as new
creates a separate entry, and Delete offers Undo.

Existing shopping-list names migrate on first load. Names without one supported
catalog identity remain visible: load the entry, choose its item, and save the
repair. Original shopping-list strings remain in preferences as a rollback archive.
Schema 3 saved entries are authoritative after migration, including an empty array.
Backups include saved filters; older backups migrate their shopping-list names.
Saving failures show a retry action while the draft stays open.

All 2,035 retained identities are discoverable: 956 normal, 979 unique and
100 runewords. The 24 untranslated normal/unique names use their localization
key with `(experimental)` rather than a guessed English name. Their masks are
grounded. Runeword names and filters can be saved, loaded and edited, but searching
is disabled while the native `filter_runeword` selector binding is unresolved.
Their saved criteria stay separate from a request so no invented mask is sent.
Saved criteria are durable independently of the current encoder for every known
item. Older request-only entries recover their criteria from a validated request.
Loading prefers those criteria and lets the current encoder construct the draft;
a future catalog/selector migration must preserve them rather than discard them.

The accessible Market ready / Market not ready indicator describes local
prerequisites; it does not prove that authentication will be accepted. When context
is missing, keep capture running and search for an item in Hero Siege's Market to
collect it. First-search region preparation and region failures have separate
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

The stat picker accepts 381 evidenced numeric IDs: the original 167 native Market
menu entries and 214 additional entries suffixed `(experimental)`. Missing English
labels remain `Stat N`. These are grounded keys from the retained native menu,
label bindings and constructor setters; they are not a complete game enum or
proof that the server honors every numeric clause. Minimum sockets keeps its
separate native field. Shared validation and the real request builder accept
these IDs consistently; arbitrary IDs remain rejected.

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

- `lib/market-items.ts`: supported catalog selection and reversible legacy migration.
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
- `shared/market-search.ts`: native and experimental stat options, shared criteria
  validation, and proven normal/unique masks. Runeword encoding stays unresolved.
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
filter saving/search, pending runeword criteria, persistence and restart.
