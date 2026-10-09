# Renderer design system

The companion uses Vue 3 in the existing Electron renderer. The design system is
shared presentation and interaction contracts; it does not require a framework
change. Keep capture, network providers, persistence and IPC in their current
owners. App.vue continues coordinating focused components and runtime modules.

## Direction and ownership

Use a quiet instrument-panel layout: a stable session command bar, keyboard
navigable views, a run summary, then progressively detailed cards. Keep the six
game-inspired palettes and textures while making geometry, control states,
focus, typography and spacing consistent. Labels and state messages carry
meaning alongside color. Keep data dense enough for a companion window.

| Owner | Contract |
| --- | --- |
| `src/renderer/src/styles/design-tokens.css` | Shared spacing, type scale, radii, control sizes, focus and elevation. Colors derive from public theme tokens. |
| `src/renderer/src/styles/design-system.css` | Final shared presentation after feature styles, all theme templates, textures and materials. Feature files retain layout and responsive rules. |
| `components/UiButton.vue` | Native button, explicit tone, submit type, disabled state and inherited labels/events. Existing icon-button selectors remain compatible. |
| `components/DialogShell.vue` | Named modal, focus containment/restoration, Escape/backdrop dismissal and optional busy dismissal guard. Settings confirmations guard active operations. |
| `components/ViewTabs.vue` / `lib/view-navigation.ts` | One tab stop, automatic activation, wrapping horizontal arrows, Home/End and focus moving with selection. App owns four stable labelled panels (Live Session, Item Filter, Market, Past Runs) while retaining lazy view mounting. |
| `components/InfoHint.vue` | Focusable explanation with an accessible label and the existing tooltip presentation. |
| `lib/modal-focus.ts` | Native summary participates in focus order; closed details, hidden/inert controls and disabled fieldsets do not. The innermost modal owns Tab. |
| `styles/theme-materials.css` | Foreground-fill defaults remain aliases; actual panel, cell and input surfaces consume public overrides. |
| `styles/market.css` | Market tab layout; geometry, focus and status roles come from the shared tokens. |
| `styles/market-search.css` | Theme-derived readiness, Timeline Market action, price, muted and error surfaces shared by Market. |

Paths in the table are relative to `src/renderer/src` unless fully specified.

## Templates that remain supported

| Display name | Persisted ID | Full and compact templates |
| --- | --- | --- |
| Dark | `dark` | `styles/themes/dark.css`, `styles/compact-themes/dark-compact.css` |
| Demonsteel | `demonsteel` | `styles/themes/demonsteel.css`, `styles/compact-themes/demonsteel-compact.css` |
| Voidglass (default) | `voidglass` | `styles/themes/voidglass.css`, `styles/compact-themes/voidglass-compact.css` |
| Reliquary | `reliquary` | `styles/themes/reliquary.css`, `styles/compact-themes/reliquary-compact.css` |
| Cyberpunk | `cyberpunk` | `styles/themes/cyberpunk.css`, `styles/compact-themes/cyberpunk-compact.css` |
| Quicksilver | `light` | `styles/themes/light.css`, `styles/compact-themes/light-compact.css` |

Preserve IDs, independently selected compact themes, Match Full App, migrated
Legacy Custom modes, per-theme accents, foreground fill and imported tokens.
Texture IDs remain `none`, `carbon-fiber`, `brimstone`, `brushed-metal`,
`slate-grid`, `neon-grid`, `reliquary-inlay`, `void-fracture`, `hex-mesh`,
`arcane-sigil` and `starfield-dust`.

The 26 public token keys remain unchanged: `appBg`, `appBgGradient`, `appText`,
`appHeading`, `appMuted`, `appMutedStrong`, `surface`, `surfaceStrong`,
`surfaceSoft`, `surfaceCell`, `surfaceHover`, `surfaceSelected`, `border`,
`borderStrong`, `accentBorder`, `accentWarm`, `accentWarmBg`, `inputBg`,
`buttonPrimary`, `buttonPrimaryHover`, `buttonPrimaryText`, `danger`, `dangerBg`,
`warning`, `scrollbar` and `shadow`. Theme exports/starter files retain version 1;
preferences/backups retain their existing schema and storage keys. The starter
instructions correctly direct import through Settings > Developers.

Compact presets remain Default Run, Loot Focused, Resource Focused and XP / Kills.
Duration remains protected; the eight-tile limit and custom item/group tiles
remain intact. Report presets remain Default, Gear Farming, Materials / Ore,
Keys, Magic-Find Focus and Satanic Zone, with their existing item/metric rules.

## Behaviors carried through

- Session controls: launch or resume capture, stop capture, pause/resume the
  current run, and end/archive a run. Compact says Pause Run / Resume Run, matching
  the full view. Native titlebar actions, pinning, full/compact sizing and
  customization survive.
- Live data: capture health/details, collapsible score and dashboard cards,
  Run Pace lanes and exact-item tracking, tracked drops/resources, Timeline
  filtering, hide/restore fixtures and chat/logs.
- Market: catalog item picker, Timeline Market action, saved items with
  Undo delete, optional socket range, stat minimums, readiness indicator, one
  explicit request in flight, independent cooldown, result table and safe errors.
  The design system changes presentation only; request, readiness and saved-filter
  behavior stay with their owners.
- Satanic Zone: passive current/stale/missed status and effects plus compact
  details. Manual refresh controls follow the release flag and are hidden while
  active refresh is disabled.
- Item Filter: ordered groups, exact items, rarity/type/stat rules, mute, sound
  selection/volume/testing, custom audio and pack import/export previews, group
  removal and missing compact-group recovery.
- Report Desk: search/tags/date library, aggregate and individual reports,
  configured summary/exact items, CSV/JSON export, clipboard summary and confirmed
  deletion. Saved run data remains independent of report configuration.
- Settings: app/appearance/support/developers sections (Features follows its
  release flag), game selection, durable preferences, backup/restore, theme
  templates, local diagnostics and bounded deep-diagnostics confirmation,
  recovery and release information.

## Acceptance checks

Run `npm test`, `npm run typecheck`, `npm run build`, and mock Electron tests.
`tests/renderer/design-system.spec.ts` checks keyboard/focus/busy contracts.
`tests/e2e/electron-design-system.spec.cjs` exercises the actual views, nested
confirmation focus, semantic Market states, public surface/input overrides in
every theme and compact pause/resume. Existing layout, settings, filter, report,
traffic, Market and capture tests remain part of verification.

The E2E tests use synthetic traffic and isolated temporary user data. The E2E
main process omits direct providers and release checks; the design-system tests
also abort renderer HTTP requests. Market responses are mocked only inside that
isolated process. Never include private capture/session material in fixtures.

Inspect both window modes, dark/light contrast, all theme families, minimum full
window width, eight compact tiles, popover stacking, one Settings content
scroller, Report Desk content sizing, visible focus and no clipped controls.
Retain existing import/export and legacy preference tests.

## Incremental follow-up

1. Keep visual/accessibility commits separable from reliability and protocol
   work. Do not infer live-service readiness from offline tests.
2. Extend primitives and focusable explanations through the remaining dialogs,
   popovers and feature controls. Add relevant keyboard and state checks as each
   owner is migrated; avoid moving runtime logic into shared presentation.
3. Reduce duplicated feature/theme selector groups, especially the large
   past-runs and Quicksilver styles, while preserving template identities and
   imported-token behavior. Replace hardcoded feature colors with semantic roles.
4. Refine information hierarchy from real-window review and practical use;
   preserve supported dense/compact layouts, report presets and data controls.

A framework conversion (for example to Svelte) is not justified by the current
evidence. Migration would replace Vue/Vite integration and Vue typechecking, add
new compiler/tooling and a component-test adapter, and rewrite component models,
slots, lifecycle hooks, lazy loading and tests, while Electron capture/IPC/shared
TypeScript would remain. None of the identified styling/focus issues requires
that cost. Reconsider only for a concrete measured capability that Vue cannot
deliver within the existing architecture, using a separately scoped proof and
full behavior parity checks before migration.
