# Patch Notes Changelist

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

## Item Assets

- Added a wiki icon sync script for Set, Satanic, Heroic, Angelic, and Unholy items.
- Added generated item icon manifest and local item icon assets.
- Added missing asset reports in Markdown and JSON.
- Improved icon resolution with loose/fuzzy wiki name matching and direct wiki image matching.

## Window And Settings

- Added separate compact/full window position persistence.
- Added a lock setting for restoring compact and full views to their last locations.
- Made the Settings dialog scrollable so controls remain reachable as the menu grows.
