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

Market readiness describes local prerequisites. Receiving all six fields does not
prove that authentication will be accepted. Search success, empty results, request
rejection and transport failure are separate outcomes. Keep capture running for
current session evidence; persistent checksum rejection has no established automatic
recovery. Searches are explicit, one request at a time, subject to the existing
cooldown. Filters are editable while waiting or after a failed request.

Price results show up to 20 gold-price listings from the first page and do not
represent the whole market. Price per unit appears when reliably decoded. The decoded
page-row count and server-returned count stay distinct from the displayed count.
Item-priced or unreadable rows may be omitted. The old compact price summary, if
reused, still displays only its lowest two cards.
Matching relies on the server. Unsupported game filter operators are not exposed.
No automated purchase, polling, alert or pagination runs from saved entries.

## Owners and verification

- `lib/market-items.ts`: supported catalog selection and reversible legacy migration.
- `lib/saved-market-items.ts`: saved request validation, load/edit/save/delete/undo.
- `lib/preferences.ts` and `lib/app-preferences.ts`: schema 3 local/backup durability.
- `lib/market-search-runtime.ts`: shared draft validation, explicit search, cooldown,
  response states and stale reply suppression.
- `components/MarketView.vue` and `styles/market.css`: tab workspace and keyboard/focus
  behavior. App coordinates navigation and typed preload calls.
- `main/captured-session-context.ts`: safe numeric readiness context version;
  identity/mode/session changes clear prices, while same-account region preparation
  preserves the first explicit search. No sensitive identity crosses this projection.
- Existing main provider/worker/reducer own authentication, HTTPS, limits and safe
  result reduction. Checksum/signature formulas remain unchanged.
- `main/market-search-handler.ts`: request validation and an allowlisted, bounded
  response for the preload IPC capability, including safe error/timing metadata.

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
