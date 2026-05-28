# Hero Siege Companion

Passive live-session tracking for Hero Siege on Windows.

Hero Siege Companion watches local Hero Siege traffic, parses the game messages it understands, and turns them into a practical desktop dashboard for runs, loot, Satanic Zone timing, item alerts, and Past Runs reporting.

> **Required before first launch:** install [Npcap](https://npcap.com/#download) so the companion can read local game traffic. The exact installer options are in [Required: Install Npcap](#required-install-npcap).

![Hero Siege Companion live dashboard](docs/assets/dashboard.png)

## Download

Download the latest Windows build from the GitHub Releases page:

[Hero Siege Companion Releases](https://github.com/DemonSkye/Hero-Siege-Companion/releases)

The release asset is the portable Windows build. Download it, unzip it if needed, and run `Hero Siege Companion.exe`.

Current release target: `v0.2.2`.

## Quick Start

1. Install [Npcap](https://npcap.com/#download) using the options shown below.
2. Start Hero Siege.
3. Launch `Hero Siege Companion.exe`.
4. Leave capture running while you play.
5. Use `End Run` when a run is complete and should be saved to Past Runs.

Most data appears after Hero Siege sends the relevant packet. For example, gold may update after a zone change or town interaction, and Satanic Zone details appear after a zone vote/reset packet arrives.

## Core Features

- Live session dashboard with capture status, packet counts, run timer, gold, XP, kills, Satanic Zone timing, and tracked drops.
- Run pause/resume controls, including automatic run pause when capture stops.
- Compact overlay mode for keeping the current run visible while playing.
- Satanic Zone name, reset countdown, pros, and cons in both full and compact views.
- Loot audio filters with custom groups, rarity/type rules, exact watched items, sound selection, volume, cooldown, and mute controls.
- Imported loot alert sounds from local audio files or zip soundpacks, plus soundpack ZIP export.
- Dark, Cyberpunk, and Light themes with separate full-app and compact choices, accent colors, and theme import/export.
- Developer item research for resolving unknown item signatures into a shareable JSON lookup contribution.
- Shopping list for quickly saving and copying marketplace searches.
- Past Runs explorer with search, compare mode, JSON export, per-run tags, configurable report cards, tracked item groups, top drops, and resource drawers.
- Settings import/export for app settings, Past Run settings, report tracking, loot filters, sounds, and optional research data.
- Support diagnostics summary copy and ZIP export for troubleshooting capture/setup issues.
- Local-only desktop app: no account login, no cloud service, and no packet capture files are written by the app.

## Live Dashboard

The dashboard is built around the current run. It tracks duration, gold, XP rate, kills, Satanic Zone timer, and any configured custom tiles. The right side focuses on drops, shopping list access, and diagnostics so the important play-session data stays visible.

Satanic Zone details use the same source data in full and compact mode: zone name, remaining time, pros, and cons come from parsed game packets and are cached until the next half-hour window.

## Compact Overlay

Compact mode is designed for playing with the companion on top of the game. It keeps the current run, gold, XP, kills, Satanic Zone timer, and custom tiles visible without taking over the screen.

![Hero Siege Companion compact overlay](docs/assets/compact.png)

Click `This Run` in compact mode to open the run details cover. Use `Pause`, `Resume`, and `End Run` without expanding back to the full desktop view.

## Past Runs

Past Runs stores local run summaries so you can compare farming strategies over time. The aggregate cards show all saved runs and the most recent runs, including total duration and average duration.

![Hero Siege Companion Past Runs](docs/assets/past-runs.png)

Use search and tags to narrow saved history by strategy, character, resource, drop, or stat. Compare mode shows the recent matching slice against the full matching set, and Export JSON writes the current matching runs plus their aggregate summary. Use `Configure Report` to choose which summary cards, rarity groups, tracked item groups, drawers, and top-drop counts appear in run recaps. Empty tracked item groups use the default rarity-based report; enabled groups focus the report on exact drops or strategies you care about.

## Loot Audio And Item Research

The Item Filter tab lets you create loot alert groups. Groups can match by rarity, item type, exact watched item, or a combination of those rules. You can use built-in synthesized sounds or imported local audio files.

![Hero Siege Companion item filters](docs/assets/item-filters.png)

Developer item research is opt-in. When enabled, unknown item signatures appear in the Item Filter tab so they can be identified, saved, and exported. Research exports are case-normalized and designed to be shared as a [GitHub Gist](https://gist.github.com/) with `sarevok9` on Reddit or `Snyne` on the Hero Siege Discord.

## Settings And Configuration

Settings are saved locally on the device and restored between sessions. Appearance settings include Dark, Cyberpunk, and Light themes, separate full/compact theme choices, accent colors, and theme JSON import/export.

The configuration JSON import/export flow can include:

- App settings
- Past run settings
- Report tracking
- Loot filters
- Sounds
- Research data

Loot filters, sounds, and research data are optional export sections so you can share a report setup without sharing every personal filter group. When Sounds is checked, imported custom audio is embedded into the configuration JSON and installed back into local app storage during import. When Sounds is unchecked, import leaves local sound preferences and embedded audio files alone.

## Required: Install Npcap

Hero Siege Companion uses the Windows packet capture driver provided by Npcap. Install Npcap before running the app.

Download Npcap from the official Npcap site:

[https://npcap.com/#download](https://npcap.com/#download)

During setup, use these options:

- Leave **Restrict Npcap driver's access to Administrators only** unchecked.
- Check **Install Npcap in WinPcap API-compatible Mode**.
- The raw 802.11 wireless option is not required for Hero Siege Companion.

![Npcap installer options](docs/assets/npcap-installer.png)

If capture does not start, reinstall Npcap with the WinPcap-compatible option enabled, then restart Hero Siege Companion.

## Development

Install dependencies:

```powershell
$env:npm_config_cache='.npm-cache'
npm install --ignore-scripts
```

Install Electron into the local cache:

```powershell
$env:electron_config_cache=(Join-Path (Get-Location) '.electron-cache')
node .\node_modules\electron\install.js
```

Rebuild the native packet capture module. This requires Python on your `PATH`; Python 3.10+ is a good default on Windows.

```powershell
npx electron-rebuild -f -w cap
```

If Python is installed but not on `PATH`, point npm at your local `python.exe` first:

```powershell
$env:npm_config_python='C:\Path\To\Python\python.exe'
npx electron-rebuild -f -w cap
```

Run the app:

```powershell
npm start
```

Run tests:

```powershell
npm test
```

Run the headless Electron E2E suite:

```powershell
npm run test:electron
```

Build the portable Windows release:

```powershell
npm run dist:win
```

For release prep, follow [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) before publishing.

## Notes

Npcap is developed by the Nmap Project. Hero Siege Companion is not affiliated with Hero Siege, Panic Art Studios, Nmap, or Npcap.
