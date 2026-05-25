# Patch Notes Changelist

## v0.2.0 Past Run Search, Audio, Themes, And Dashboard Polish

- Npcap is still required for capture. Install it from https://npcap.com/#download with WinPcap API-compatible mode enabled.
- Added Past Runs search across tags, drops, resources, characters, dates, duration, gold, XP, and kills.
- Added per-run tags for Past Runs, with a tag picker that can reuse saved tags or create new ones.
- Added imported loot alert sounds for rarity groups and exact watched items.
- Added support for importing local sound files and zip soundpacks into Settings > Sounds.
- Added Dark, Cyberpunk, and Light theme presets.
- Added compact mode theming so the overlay can use a different theme and accent color from the full dashboard.
- Added theme import/export for sharing a base theme, accent color, and optional app chrome tokens.
- Added a one-time What's New prompt for updated versions, plus a permanent What's New panel in Settings.
- Added separate full-app and compact theme controls under Settings > Appearance.
- Added configurable Past Runs reports with summary cards, rarity filters, tracked item groups, resource drawers, and top-drop limits.
- Added custom compact/full dashboard run tiles, including counters backed by item filter groups or exact item names.
- Added Npcap setup checks near capture controls for common setup problems.
- Improved Cyberpunk theme polish with a warmer left-side glow, smoother panel sheen, and more consistent Live Session page surfaces.
- Fixed compact mode ignoring theme selection by applying compact-specific theme state while compact mode is active.
- Fixed Live Session using a visibly different dashboard background from Item Filter and Past Runs.

## v0.1.6 Report Customization, Item Research, And Compact Run Controls

- Added configurable Past Runs reports with summary card toggles, rarity inclusion, tracked item groups, resource drawers, and top-drop limits.
- Added materials, non-basic keys, and ore drawers to run recaps, with denser per-run resource chips.
- Added configuration import/export with checkbox scopes for app settings, past run settings, report tracking, loot filters, and item research.
- Added optional developer item research for unknown/generic item signatures, including Identify actions, case-normalized resolved names, notes, local storage, and standalone research JSON export.
- Added GitHub Gist guidance for sharing item research with `sarevok9` on Reddit or `Snyne` on the Hero Siege Discord.
- Added `The Wheel of Fortune` to stack item lookups for collectible `type 13 / id 24`.
- Restored item drop visibility in the live log and exposed item event details, including magic-find drop flags.
- Added shared run pause/resume state for full and compact UI. Capture stop now pauses the current run, and run duration/rates exclude paused time.
- Reworked compact mode around `This Run`, gold, XP per hour, and `SZ`, with compact run details and Satanic Zone trays.
- Reduced compact overlay clutter by moving secondary stats out of the default bottom row and into compact detail views.
- Updated version metadata and packaging target to `0.1.6`.

## v0.0.9 Diagnostic Logging Follow-Up

- Added low-frequency app heartbeats with capture status, renderer state, memory usage, pending event backlog, and recent stats.
- Added low-frequency capture heartbeats with native handle state, active connection signature, packet/payload/event counters, parser counters, and packet-buffer size.
- Added capture refresh error logging so polling failures are visible without stopping capture.
- Added app-log entries for capture status transitions and high pending-event backlogs.
- Increased app and capture debug log retention to preserve more context around intermittent crashes.

## v0.0.8 Capture Stability Follow-Up

- Stopped reopening the native Npcap capture handle for ordinary Hero Siege connection churn.
- Switched to a stable local-address capture filter that excludes HTTP/HTTPS traffic so town/codex connection changes do not force a native close/open cycle.
- Added debug logging when connection signatures change but the existing capture handle is intentionally kept alive.

## v0.0.7 Capture Stability Follow-Up

- Debounced capture filter reopens when Hero Siege briefly changes its active game-server connections.
- Added a minimum interval between native Npcap handle reopens to reduce crash risk during connection churn.
- Changed capture reopen order so the old Npcap handle is closed before opening the replacement handle.
- Added debug logging for scheduled capture reopens so future logs show when connection churn is being intentionally coalesced.

## v0.0.6 Follow-Up Bugfix Release

- Reduced renderer pressure during heavy Bloodpact loot sessions by batching parsed capture events and publishing state updates at most once per second.
- Tightened capture filters to Hero Siege game-server host and port pairs, while excluding HTTP/HTTPS launcher or CDN traffic from capture and debug logging.
- Suppressed routine item-only capture debug payloads and live item log rows so loot-heavy sessions do not flood the renderer or log file.
- Fixed known item rarity resolution when Hero Siege sends an unknown numeric rarity code, so known Set items such as Aztec Devil and Pirate Captain's Shirt count correctly.
- Added a regression test for unknown numeric rarity codes falling back to the known item rarity map.

## v0.0.5 Bugfix Release

- Fixed Bloodpact/private-season sessions so captured `blood_pact` route packets set the companion to GBP mode even before a full account packet arrives.
- Added parser isolation around capture payload decoding, event parsing, event filtering, and diagnostic probes so malformed packets are dropped instead of crashing the main process.
- Added parser recovery that clears capture buffers, closes the active capture handle, and reopens capture after repeated parser failures.
- Added parser health counters for errors and recovery restarts in the capture health panel.
- Added safer parser field access so unexpected or hostile message shapes are skipped without throwing.
- Added main-process protection around stats updates so a bad parsed event cannot take down the app.
- Added non-graceful exit diagnostics, including renderer crash recovery, Electron child-process logging, app session heartbeat tracking, local crash dump path logging, and next-launch detection of unclean exits.
- Reduced capture debug-log noise from routine packets and redacted account/checksum/hash identifiers from debug snippets.
- Added capture startup diagnostics for adapter lookup, capture-open, capture-open failures, and waiting-for-connection states.

## Launch And Capture

- Renamed the primary idle action to Launch Game.
- Added Steam launch support with `steam://rungameid/269210`.
- Added an alternate executable path picker for non-Steam launches.
- After launching Hero Siege, the companion now waits about 45 seconds and automatically attempts capture.
- Capture startup messaging now references Launch Game instead of Start Capture.
- Capture startup is more conservative around Easy Anti-Cheat and avoids starting when Hero Siege is not running.

## Shopping List

- Added a Marketplace shopping list panel with add, remove, autocomplete, copy, and persisted saved items.
- Moved shopping list editing out of Settings.
- Compact mode now has a shopping-list tray and a dismiss button.
- Shopping autocomplete now includes known items, keys, materials, socketables, and resolved icon names.

## Drop Tracking

- Added item icons for recent item timeline and live log rows when assets are available.
- Added clickable tracked drop counters that expand into per-item drop breakdowns with icon, name, and count.
- Added per-session drop breakdown tracking by rarity.
- Added Set and Satanic drop totals to Past Runs.
- Added expandable Past Run drop counters for Set, Satanic, Heroic, and Angelic drops.
- Past Runs now save per-item drop details for newly archived runs.

## Item Assets

- Added a wiki icon sync script for Set, Satanic, Heroic, Angelic, and Unholy items.
- Added generated item icon manifest and local item icon assets.
- Added missing asset reports in Markdown and JSON.
- Improved icon resolution with loose/fuzzy wiki name matching and direct wiki image matching.

## Window And Settings

- Added separate compact/full window position persistence.
- Added a lock setting for restoring compact and full views to their last locations.
- Made the Settings dialog scrollable so controls remain reachable as the menu grows.
