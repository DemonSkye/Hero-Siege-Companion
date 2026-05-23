# Testing Guide

Last updated: 2026-05-23 for `0.1.4`.

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
- `tests/renderer/item-filters.spec.ts`
  Item filter normalization, watched-item canonicalization, matching precedence, default group creation, and timeline key stability.
- `tests/renderer/preferences.spec.ts`
  Renderer local-storage preference loading, saving, fallback, and normalization.
- `tests/renderer/components.spec.ts`
  Vue component contracts for Update Banner, Compact View, Item Filter View, Settings Modal, Past Runs, and Live View.
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
- Server "just found" drops.
- Fingerprint-based item type inference.
- Known item rarity overrides.
- Stack item/material/key lookup.
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

### Vue Components

Component tests mount real Vue components with Vue Test Utils and assert the contracts App.vue relies on:

- Buttons emit the correct events.
- `defineModel` bindings emit explicit `update:*` events.
- Props render the important player-visible state.
- High-churn dashboard controls do not silently stop wiring through.
- Past Runs aggregate and per-run breakdown interactions keep working.
- Compact overlay shopping actions remain reachable in the small UI.

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

- 4 spec files.
- 59 passing tests.
- Parser/stats coverage remains the largest block because networking payload shape is the riskiest part of the app.
- Renderer tests now cover both pure helper logic and mounted Vue component contracts.
