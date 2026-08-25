# Hero Siege Companion

Local live-session tracking for Hero Siege on Windows.

Hero Siege Companion passively watches local Hero Siege traffic, parses the game messages it understands, and turns them into a practical desktop dashboard for runs, loot, Satanic Zone timing, item alerts, and Past Runs reporting. An optional manual Satanic Zone refresh is available behind a setting that is off by default.

> **Required before first launch:** install [Npcap](https://npcap.com/#download) so the companion can read local game traffic. The exact installer options are in [Required: Install Npcap](#required-install-npcap).

![Hero Siege Companion live dashboard](docs/assets/dashboard.png)

## Download

Download the latest Windows build from the GitHub Releases page:

[Hero Siege Companion Releases](https://github.com/DemonSkye/Hero-Siege-Companion/releases)

The release asset is the portable Windows build. Download it, unzip it if needed, and run `Hero Siege Companion.exe`.

Current release target follows the `version` field in `package.json`.

## Quick Start

1. Install [Npcap](https://npcap.com/#download) using the options shown below.
2. Launch `Hero Siege Companion.exe`.
3. If you use manual Satanic Zone refresh, install its optional dependency and enable the feature now.
4. Start Hero Siege and leave capture running while you play.
5. Use `End Run` when a run is complete and should be saved to Past Runs.

Most data appears after Hero Siege sends the relevant packet. For example, gold may update after a zone change or town interaction, and Satanic Zone details normally arrive during world entry or through a later passive/manual update.

If you opt into manual Satanic Zone refresh, enable it in **Settings > Capture before Hero Siege connects**. If the game is already connected, reconnect or restart it so the local relay can attach.

## Core Features

- Live session dashboard with capture status, packet counts, run timer, gold, XP, kills, Satanic Zone timing, and tracked drops.
- Run pause/resume controls, including automatic run pause when capture stops.
- Compact overlay mode for keeping the current run visible while playing.
- Satanic Zone name, reset countdown, pros, cons, and freshness status in both full and compact views.
- Optional recycle-style Satanic Zone refresh icon beside the full-view countdown and the configured compact SZ timer tile, hidden until enabled and gated for exactly 30 seconds from each accepted refresh handoff.
- Loot audio filters with custom groups, rarity/type rules, exact watched items, sound selection, volume, cooldown, and mute controls.
- Imported loot alert sounds from local audio files or zip soundpacks, plus soundpack ZIP export.
- Dark, Demonsteel, Voidglass, Reliquary, Cyberpunk, and Quicksilver themes with separate full-app and compact choices, accent colors, and theme import/export.
- Developer item research for resolving unknown item signatures into a shareable JSON lookup contribution.
- Shopping list for quickly saving and copying marketplace searches.
- Past Runs explorer with search, compact run rows, expandable details, JSON/CSV export, Discord-friendly summary copy, report presets, per-run tags, delete controls, configurable report cards, tracked item groups, top drops, and resource drawers.
- Settings import/export for app settings, Past Run settings, report tracking, loot filters, sounds, and optional research data.
- Support diagnostics summary copy, log folder opening, and sanitized ZIP export with app-session state and Crashpad report metadata (never dump memory) for troubleshooting capture/setup issues.
- Local-only desktop app: no account login, no cloud service, and no packet capture files are written by the app.

## Live Dashboard

The dashboard is built around the current run. It tracks duration, gold, XP rate, kills, Satanic Zone timer, and any configured custom tiles. The right side focuses on drops, shopping list access, and diagnostics so the important play-session data stays visible.

Satanic Zone details use the same current-run source data in full and compact mode: zone name, remaining time, pros, and cons come from fresh parsed game packets or the optional sanitized manual-refresh result. The Companion does not restore a prior zone, effects, source, or observation time when it launches. `End Run` also clears the current Satanic Zone details for the next run; the next passive or manual response repopulates them.

Manual refresh is enabled from **Settings > Capture** and remains off until you choose it. The opt-in is stored by the main process and restored across Companion launches. While it is off, the dashboard and compact overlay show no manual-refresh control or enablement guidance. While it is on, an accessible recycle-style icon appears beside the full-view SZ countdown and, when that tile is configured, beside the compact SZ timer. The UI disables the icon only while it is submitting that click and during the 30-second window that begins when a refresh handoff is accepted; passive Satanic Zone activity, capture status, and cached relay readiness do not gray it out. Every other click reaches the main process. The relay derives the request context from ordinary authenticated API traffic and queues a committed click briefly if the current frame boundary is incomplete; no prior Satanic Zone exchange or vote reset is required. A still-active cooldown can survive a Companion restart, and `End Run` preserves the opt-in, availability, active request, and cooldown even while clearing the prior observation. Unavailable checks and requests rejected before handoff do not start it. The feature does not poll the server or automatically retry a network request. Disabling the setting stops the Companion-owned relay.

## Compact Overlay

Compact mode is designed for playing with the companion on top of the game. It keeps the current run, gold, XP, kills, Satanic Zone timer, and custom tiles visible without taking over the screen.

![Hero Siege Companion compact overlay](docs/assets/compact.png)

Click `This Run` in compact mode to open the run details cover. Use `Pause`, `Resume`, and `End Run` without expanding back to the full desktop view. Dashboard tile presets can switch the compact run view between default, loot, resource, and XP/kills layouts. If manual Satanic Zone refresh is enabled and the compact layout includes the SZ timer tile, its recycle icon uses the same submission and 30-second deadline rules as the full dashboard.

## Past Runs

Past Runs stores local run summaries so you can review farming strategies over time. The aggregate card follows the current search/tag filter and uses the report sections you choose, including total duration and average duration. Drop totals are tracked item drops, magic-find flagged counts are server-provided flags, and unique counts distinct item names.

![Hero Siege Companion Past Runs](docs/assets/past-runs.png)

Use search and tags to narrow saved history by strategy, character, resource, drop, or stat. Export JSON writes the current matching runs plus their aggregate summary, and Export CSV writes the current aggregate rows for spreadsheet sharing. Copy Summary creates Discord-friendly text for the current filtered result set or a single saved run. Use `Configure Report` presets or manual controls to choose which summary cards, rarity recaps, tracked item groups, drawers, and top-drop counts appear in run recaps. Empty tracked item groups use the selected rarity recaps; enabled groups focus the report on exact drops or strategies you care about.

## Loot Audio And Item Research

The Item Filter tab lets you create loot alert groups. Groups can match by rarity, item type, exact watched item, or a combination of those rules. You can use built-in synthesized sounds or imported local audio files.

![Hero Siege Companion item filters](docs/assets/item-filters.png)

Developer item research is opt-in. When enabled, unknown item signatures appear in the Item Filter tab so they can be identified, saved, filtered by status/type/rarity, and exported. Research rows label whether an entry looks like an unknown normal item, stack item, material/collectible, generated placeholder, or known item missing an icon. Research exports are case-normalized and can be scoped to resolved or unresolved rows for sharing as a [GitHub Gist](https://gist.github.com/) with `sarevok9` on Reddit or `Snyne` on the Hero Siege Discord.

## Settings And Configuration

Settings are saved locally on the device and restored between sessions. Appearance settings include Dark, Demonsteel, Voidglass, Reliquary, Cyberpunk, and Quicksilver themes, separate full/compact theme choices, accent colors, and theme JSON import/export.

The manual Satanic Zone refresh opt-in is stored locally by the main process and restored across Companion launches, but is intentionally excluded from configuration import/export so importing someone else's settings cannot enable it.

Settings, What's New, Item Filter confirmation, and Past Runs report dialogs keep keyboard focus inside the open dialog and return focus to the invoking control when closed.

The configuration JSON import/export flow can include:

- App settings
- Past run settings
- Report tracking
- Loot filters
- Sounds
- Research data

Loot filters, sounds, and research data are optional export sections so you can share a report setup without sharing every personal filter group. When Sounds is checked, imported custom audio is embedded into the configuration JSON and installed back into local app storage during import. When Sounds is unchecked, import leaves local sound preferences and embedded audio files alone.

## Required: Install Npcap

Hero Siege Companion uses the Windows packet capture driver provided by Npcap. Install Npcap before running the app. Npcap is used only to read traffic; the manual refresh feature does not inject raw TCP frames through Npcap.

Download Npcap from the official Npcap site:

[https://npcap.com/#download](https://npcap.com/#download)

During setup, use these options:

- Leave **Restrict Npcap driver's access to Administrators only** unchecked.
- Check **Install Npcap in WinPcap API-compatible Mode**.
- The raw 802.11 wireless option is not required for Hero Siege Companion.

![Npcap installer options](docs/assets/npcap-installer.png)

If capture does not start, reinstall Npcap with the WinPcap-compatible option enabled, then restart Hero Siege Companion.

## Experimental: Manual Satanic Zone Refresh

Manual refresh is an experimental, default-off feature that uses a hidden local `mitmdump` relay scoped to `Hero_Siege.exe`. The Companion includes its relay addon, but the current runtime does not bundle `mitmdump`: install [mitmproxy](https://www.mitmproxy.org/) in its standard Windows location or make `mitmdump.exe` available on `PATH`.

Because this feature uses a local proxy relay, some VPNs, system proxy configurations, and network-security tools may conflict with it. The same warning is shown beside the opt-in checkbox.

Enable the feature before starting or connecting Hero Siege so the local relay owns the connection from its beginning. If you enable it after the game has already connected, reconnect or restart the game so the connection can pass through the relay. Ordinary authenticated API traffic supplies the account context and counter state used for manual refresh; a prior Satanic Zone exchange and vote reset are not required. A click made while the connection is momentarily between complete frames waits boundedly for a safe boundary rather than requiring another click. This is local flow coordination, not server polling.

The Companion owns the relay it starts and stops it when the setting is disabled; disabling it during a connected session may therefore make the game reconnect. The relay also shuts itself down if the Companion exits. Its process and connection details stay internal and are not stored or exposed in the UI. Only that owned relay is added to passive capture so ordinary item and stat updates continue. Product operation writes no packet-capture files.

The source tree includes the six-file relay addon under `resources/satanic-zone-relay`, and Windows packaging copies those Python files into the runtime resource directory. Development and packaged resource paths are selected explicitly and covered by automated tests. Live in-world refresh has passed in both Nightmare and Hell; portable packaged-executable startup with the installed mitmproxy dependency remains the release check. If installed `mitmdump` is unavailable, the feature fails closed as unavailable.

## Development

Install dependencies:

```powershell
$env:npm_config_cache='.npm-cache'
npm install --ignore-scripts
```

Install Electron into the local cache:

```powershell
$env:electron_config_cache=(Join-Path (Get-Location) '.electron-cache')
npm run postinstall:electron
```

Rebuild the native packet capture module. This command first applies the required Windows close-retention and no-current-context teardown repairs, then invokes Electron Rebuild. It requires Python on your `PATH`; Python 3.10+ is a good default on Windows.

```powershell
npm run rebuild
```

If Python is installed but not on `PATH`, point npm at your local `python.exe` first:

```powershell
$env:npm_config_python='C:\Path\To\Python\python.exe'
npm run rebuild
```

Run the app:

```powershell
npm start
```

For development of manual Satanic Zone refresh, keep the packaged relay sources under `resources/satanic-zone-relay` and install mitmproxy so `mitmdump.exe` is in its standard Program Files location or on `PATH`. Enable the setting before establishing the Hero Siege connection.

Run tests:

```powershell
npm test
```

Run strict main and renderer typechecks:

```powershell
npm run typecheck
```

Run the headless Electron E2E suite:

```powershell
npm run test:electron
```

Build the portable Windows release:

```powershell
npm run dist:win
```

## Notes

Npcap is developed by the Nmap Project. Hero Siege Companion is not affiliated with Hero Siege, Panic Art Studios, Nmap, or Npcap.
