# Hero Siege Companion v0.2.0

Npcap is still required for capture. Install it from https://npcap.com/#download and enable WinPcap API-compatible mode during setup.

## Highlights

- Past Runs now has search across tags, drops, resources, characters, dates, duration, gold, XP, and kills.
- Saved runs can now be tagged. Reuse existing tags from history or create new tags directly from a run.
- Loot alert audio now supports imported local sounds and zip soundpacks for rarity groups and exact watched items.
- Themes are now a first-class setting, with Dark, Cyberpunk, and Light presets, separate full-app and compact choices, accent colors, and theme import/export.
- Settings now includes a What's New panel, with a one-time prompt after version updates.
- Cyberpunk received a restrained polish pass with warmer left-side glow, smoother panel sheen, and a more consistent Live Session canvas.

## Past Runs

- Added Past Runs search with matching aggregate summaries for all matching runs and recent matching runs.
- Added per-run tag chips and a tag picker for saved runs.
- Added tag filter buttons so saved tags can quickly narrow the run history.
- Added configurable report cards, rarity filters, tracked item groups, resource drawers, and top-drop limits.

## Dashboard And Compact Mode

- Added customizable run dashboard tiles shared by full and compact views.
- Added custom tile counters backed by loot filter groups or exact item names.

## Themes And Appearance

- Added Dark, Cyberpunk, and Light theme presets.
- Added separate full-app and compact theme selectors under Settings > Appearance.
- Added separate full-app and compact accent controls.
- Added theme import/export for sharing a base theme, accent color, and optional app chrome tokens.
- Kept rarity colors game-matched instead of applying theme overrides to drop rarity colors.
- Fixed compact mode ignoring theme selection by applying the compact theme while compact mode is active.

## Loot Alerts And Setup

- Added imported loot alert sounds for rarity groups and exact watched items.
- Added support for importing .wav, .mp3, .ogg, .m4a, .aac, .flac, .webm, and .zip soundpacks.
- Added Settings > Sounds management for imported loot alert sounds.
- Added Npcap setup checks near capture controls for common capture prerequisites.
- Added capture diagnostics copy support for easier troubleshooting.

## Fixes And Polish

- Fixed Live Session using a visibly different dashboard background from Item Filter and Past Runs.
- Smoothed the Cyberpunk panel animation so the loop returns to its starting frame before repeating.
- Added a simple updated-version prompt that opens Settings > What's New when selected.
- Kept the prompt version-gated so it appears once per app version.
