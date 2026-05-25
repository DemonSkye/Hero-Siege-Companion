# Testing Guide

Last updated: 2026-05-25 for `0.2.0`.

The test suite uses Vitest, Vue Test Utils, and jsdom. The goal is executable documentation: each test should describe a real packet, parser rule, stats rule, preference guard, or component contract that can regress.

## Commands

```powershell
npm test
```

Runs all Vitest specs.

```powershell
npm run test:watch
```

Runs Vitest in watch mode.

## Test Layout

- `tests/shared/parser-stats.spec.ts`
  Packet-shaped parser and stats regressions. These are the old high-value parser tests moved to Vitest and pointed at TypeScript source instead of compiled `dist`.
- `tests/main/persistence.spec.ts`
  Main-process persistence helper coverage for preferences, Past Runs migration, preference section preservation, and window bounds normalization.
- `tests/main/packet-decoder.spec.ts`
  Packet decoder coverage for supported link types, unsupported packets, parseable payload screening, and TCP payload buffering.
- `tests/main/capture-network.spec.ts`
  Main-process capture network helper coverage for web-connection filtering, stable capture filters, connection signatures, and connection summaries.
- `tests/main/capture-service.spec.ts`
  CaptureService lifecycle coverage for game-exit teardown, native handle closing, and idle-state emission.
- `tests/main/capture-events.spec.ts`
  Capture event helper coverage for debug payload selection, generated item trust recognition, event log suppression, and formatting helpers.
- `tests/main/capture-event-state.spec.ts`
  Capture event-state coverage for parsed-event deduplication and generated-drop request/response correlation.
- `tests/main/capture-debug.spec.ts`
  Debug helper coverage for sensitive snippet redaction, binary/whitespace normalization, and length limits.
- `tests/main/app-diagnostics.spec.ts`
  App diagnostics coverage for debug log writing, app-session file writing, and previous-session crash hints.
- `tests/renderer/shopping-list.spec.ts`
  Shopping-list helper coverage for canonical add, case-insensitive dedupe, removal, and active-index handling.
- `tests/renderer/shopping-list-runtime.spec.ts`
  Shopping-list runtime coverage for canonical adds, clipboard copy, active-item advancement, and suggestion filtering.
- `tests/renderer/session-display.spec.ts`
  Renderer display projection coverage for capture status, run tiles, resources, timeline filtering, tracked drops, and pause gating.
- `tests/renderer/support-diagnostics-runtime.spec.ts`
  Support diagnostics runtime coverage for metadata loading, fallback metadata, ZIP save flow, and toast behavior.
- `tests/renderer/window-mode.spec.ts`
  Window/compact-mode runtime coverage for always-on-top, compact state, settings behavior, and preload IPC calls.
- `tests/renderer/item-filters.spec.ts`
  Item filter normalization, watched-item canonicalization, matching precedence, default group creation, and timeline key stability.
- `tests/renderer/preferences.spec.ts`
  Renderer local-storage preference loading, saving, fallback, normalization, configuration transfer, theme import/export, compact tiles, and item research export.
- `tests/renderer/past-run-search.spec.ts`
  Pure Past Runs search/tag helper coverage for queries, tags, drops, resources, stats, tag options, and case-insensitive tag mutation.
- `tests/renderer/components.spec.ts`
  Vue component contracts for shell components, Update Banner, Compact View, Item Filter View, Settings Modal, Past Runs, and Live View.
- `tests/renderer/fixtures.ts`
  Shared renderer fixtures for `CompanionState`, item timeline entries, filter groups, and past runs.

## What The Tests Protect

### Parser And Stats

These tests protect the moving contract between raw Hero Siege traffic and live stats:

- Field renames and snake/camel-case drift.
- Nested payload flattening.
- Query-string payloads and nested query JSON.
- Loose/corrupt currency payload recovery.
- Gold mode selection and mode changes.
- Gold snapshot precedence over noisy delta fields.
- Hostile or malformed message objects.
- Satanic Zone names, buffs, and debuffs.
- Base64 item packets.
- Mail packet interpretation.
- Inventory item adds.
- Generated itemData false-positive prevention.
- Trusted/generated drop correlation.
- Supported link-type packet decoding.
- Lightweight TCP payload buffering and parseability screening.
- Capture connection filtering before Npcap filter selection.
- Capture debug redaction before payload snippets are written.
- App debug/session diagnostics stay isolated from main-process orchestration.
- Server "just found" drops.
- Fingerprint-based item type inference.
- Known item rarity overrides.
- Stack item/material/key lookup.
- Item research candidate detection, name normalization, and research JSON export.
- Timeline filtering assumptions.
- Run summaries and empty-run detection.

### Renderer Logic

These tests protect renderer-side behavior that can break without TypeScript noticing:

- Persisted item filter groups are sanitized before use.
- Exact watched items override broader rarity/type matching.
- Watched item names are canonicalized and deduped.
- Item filter groups start with safe defaults.
- Preferences loaded from storage are normalized before reaching UI state.
- Shopping list helpers dedupe and bound stored values.
- Configuration import/export respects the selected checkbox scope.
- Post-run report configuration and item research entries are normalized before reaching UI state.
- Theme import/export accepts only supported theme IDs, accent colors, and safe token values.
- Custom item filter sounds are normalized before they can be used by groups or exact watched items.
- Past Runs search/tag helpers can be changed without mounting the full view.
- Shopping-list helpers can be changed without mounting the full renderer.
- Session display, shopping runtime, support diagnostics runtime, and window mode can change without remounting `App.vue`.
- Tag matching remains case-insensitive while display casing is preserved.
- Main-process JSON persistence preserves unrelated preference sections and migrates additive Past Run fields safely.
- Main-process capture helpers stay deterministic and testable outside the native Npcap service.
- CaptureService closes active native handles and returns to idle when Hero Siege exits.
- Generated-drop correlation and event dedupe stay covered without constructing `CaptureService`.

### Vue Components

Component tests mount real Vue components with Vue Test Utils and assert the contracts App.vue relies on:

- Buttons emit the correct events.
- `defineModel` bindings emit explicit `update:*` events.
- Props render the important player-visible state.
- High-churn dashboard controls do not silently stop wiring through.
- Past Runs aggregate and per-run breakdown interactions keep working.
- Npcap setup checklist rendering stays wired through Live View.
- Compact overlay shopping actions remain reachable in the small UI.
- Compact run controls, run details overlays, and zone trays remain wired through.
- Shell titlebar, live-session header, and What's New prompt actions remain wired through.

## Guidelines For New Tests

- Prefer real packet-shaped fixtures over invented idealized payloads.
- Give tests names that explain the regression being prevented.
- When testing Vue components, assert emitted events and model updates, not snapshots.
- Use shared fixtures only for stable app shapes; put unusual payloads inline so the reason for the test is visible.
- If a bug came from live traffic, preserve the smallest safe payload that reproduces it.
- Keep parser/stats tests source-level. They should not depend on `dist` being built first.
- Add a component test when changing prop/event/model contracts between `App.vue` and a child component.

## Current Coverage Count

As of this update:

- 18 spec files.
- 107 passing tests.
- Parser/stats coverage remains the largest block because networking payload shape is the riskiest part of the app.
- Renderer tests now cover both pure helper logic and mounted Vue component contracts.
