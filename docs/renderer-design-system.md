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
| `components/DialogShell.vue` | Named modal, focus containment/restoration, Escape/backdrop dismissal and optional busy dismissal guard. Market remains closable while searching; Settings confirmations guard active operations. |
| `components/ViewTabs.vue` / `lib/view-navigation.ts` | One tab stop, automatic activation, wrapping horizontal arrows, Home/End and focus moving with selection. App owns three stable labelled panels while retaining lazy view mounting. |
| `components/InfoHint.vue` | Focusable explanation with an accessible label and the existing tooltip presentation. |
| `lib/modal-focus.ts` | Native summary participates in focus order; closed details, hidden/inert controls and disabled fieldsets do not. The innermost modal owns Tab. |
| `styles/theme-materials.css` | Foreground-fill defaults remain aliases; actual panel, cell and input surfaces consume public overrides. |
| `styles/market-search.css` | Theme-derived readiness, price, muted, error and filter surfaces; Market layout and narrow-window adaptation. |

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

## Behaviors carried through the first slice

- Session controls: launch or resume capture, stop capture, pause/resume the
  current run, and end/archive a run. Compact now says Pause Run consistently.
  Native titlebar actions, pinning, full/compact sizing and customization survive.
- Live data: capture health/details, collapsible score and dashboard cards,
  Run Pace lanes and exact-item tracking, tracked drops/resources, Timeline
  filtering, hide/restore fixtures, shopping list copy/autocomplete and chat/logs.
- Market: explicit Timeline lookup, optional sockets/stat minimums, readiness
  disclosure, missing/expired context, region preparation/failure, one request in
  flight, close/reopen and edited-draft behavior, lowest two prices, unknown totals,
  cached/observed results, errors and independent cooldown. No account/session
  values or endpoints are added to the readiness display.
- Satanic Zone: passive current/stale/missed status and effects, compact details,
  refresh opt-in/confirmation, manual submission and cooldown controls. UI changes
  do not imply that the direct protocol has been accepted by a live service.
- Item Filter: ordered groups, exact items, rarity/type/stat rules, mute, sound
  selection/volume/testing, custom audio and pack import/export previews, group
  removal and missing compact-group recovery.
- Report Desk: search/tags/date library, aggregate and individual reports,
  configured summary/exact items, CSV/JSON export, clipboard summary and confirmed
  deletion. Saved run data remains independent of report configuration.
- Settings: app/appearance/features/support/developers sections, game selection,
  durable preferences, backup/restore, theme templates, local diagnostics and
  bounded deep-diagnostics confirmation, recovery and release information.

## Acceptance checks

Run `npm test`, `npm run typecheck`, `npm run build`, and mock Electron tests.
`tests/renderer/design-system.spec.ts` checks keyboard/focus/busy contracts.
`tests/e2e/electron-design-system.spec.cjs` exercises the actual views, native
readiness disclosure, nested confirmation focus, semantic Market states, public
surface/input overrides in every theme and compact pause/resume. Settings-driven
coverage also checks all six supplied palettes at minimum full window size and
with eight compact tiles. Market error contrast uses computed text color and
sampled composited screenshot backgrounds, with a 4.5:1 normal-text threshold.
The internal error text/background roles alias public `appText`/`dangerBg`;
imported themes retain the existing public API. This checks supplied defaults
and does not guarantee contrast for arbitrary custom palettes. Existing layout,
settings, filter, report, traffic and capture tests remain part of verification.

Screenshots are opt-in with `HSC_UX_SCREENSHOTS=1` and written to the ignored
Playwright output directory. Use synthetic traffic and isolated temporary user
data. The E2E main process omits direct providers and release checks; the new
tests also abort renderer HTTP requests. Market responses are mocked only inside
that isolated process. Never include private capture/session material in visual
fixtures or screenshots.

Inspect both window modes, dark/light contrast, all theme families, minimum full
window width, eight compact tiles, popover stacking, one Settings content
scroller, Report Desk content sizing, visible focus and no clipped controls.
Retain existing import/export and legacy preference tests.

## Incremental follow-up

1. Review and integrate this slice from the isolated branch after preserving the
   runtime baseline. Keep visual/accessibility commits separable from reliability
   and protocol work. Do not infer live-service readiness from offline tests.
2. Extend primitives and focusable explanations through the remaining dialogs,
   popovers and feature controls. Add relevant keyboard and state checks as each
   owner is migrated; avoid moving runtime logic into shared presentation.
3. Reduce duplicated feature/theme selector groups, especially the large
   past-runs and Quicksilver styles, while preserving template identities and
   imported-token behavior. Replace hardcoded feature colors with semantic roles.
4. Refine information hierarchy from real-window review and practical use;
   preserve supported dense/compact layouts, report presets and data controls.

A Svelte conversion is not justified by the current evidence. The baseline has
41 Vue components (about 6,562 lines), 14 Vue-dependent renderer modules and
24 renderer spec files, including Vue/test-utils harnesses. Migration would
replace Vue/Vite integration and Vue typechecking, add Svelte/compiler/tooling
and a suitable component-test adapter, and rewrite component models, slots,
lifecycle hooks, lazy loading and tests. Electron capture/IPC/shared TypeScript
would remain. None of the identified styling/focus issues requires that cost.
Reconsider only for a concrete measured capability that Vue cannot deliver
within the existing architecture, using a separately scoped proof and full
behavior parity checks before migration.
