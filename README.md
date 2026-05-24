# Hero Siege Companion

Passive live-session tracking for Hero Siege on Windows.

Hero Siege Companion watches local Hero Siege traffic, parses the game messages it understands, and turns the useful bits into a clean desktop dashboard: run time, gold and XP rates, mailbox status, Satanic Zone details, tracked drops, item history, customizable run reports, and capture diagnostics.

**Requires Npcap:** install Npcap before running the app so Hero Siege Companion can read local game traffic. See [Required: Install Npcap](#required-install-npcap) for the recommended installer settings.

![Hero Siege Companion live dashboard](docs/assets/app.png)

## Download

Download the latest Windows build from the GitHub Releases page:

[Hero Siege Companion Releases](https://github.com/DemonSkye/Hero-Siege-Companion/releases)

The release asset is the portable Windows build. Download it, unzip it if needed, and run `Hero Siege Companion.exe`.

Current release target: `v0.1.6`.

## Features

- Live capture status with packet and parse counts.
- Run timer, character name, gold earned, current gold, XP earned, and per-hour rates.
- Run pause/resume controls, with automatic run pause when capture stops.
- Mailbox state detection from game packets.
- Satanic Zone name, reset countdown, pros, and cons.
- Tracked drop counters for Set, Satanic, Heroic, Angelic, non-basic keys, and mined ore.
- Item timeline with filters for item type, keys, socketables, materials, and material-like collectibles.
- Loot audio item filter with custom groups, rarity/type rules, exact watched items, per-item sound overrides, volume, cooldowns, and a global mute.
- Optional developer item research for resolving unknown item IDs into a shareable lookup JSON.
- Shopping list for quickly copying saved item names into marketplace searches.
- Expandable diagnostics log with color-coded event labels and item-event details.
- Past Runs explorer with configurable summary cards, tracked item groups, resource drawers, top drops, and per-run item breakdowns.
- Compact overlay mode for keeping capture status, this-run stats, gold, XP rate, Satanic Zone timer, and shopping list access visible while playing.
- Launch helper that can start Hero Siege through Steam or a selected executable.
- Settings for always-on-top, saved compact/full window positions, timeline filters, run-history rules, verbose live logging, and configuration import/export.
- Release update notice when a newer GitHub release is available.
- Local-only desktop app: no account login, no cloud service, and no packet capture files are written by the app.

## Compact Overlay

Compact mode shrinks the companion down to a small overlay-friendly view with connection status, clock, this-run timer, gold, XP per hour, Satanic Zone countdown, and quick shopping-list access.

Click `This Run` to open a compact stats overlay with the current run details. Use `Pause` and `End` below the timer to control the run without expanding to the full view. If capture stops, the current run pauses automatically so downtime is not counted in run rates.

![Hero Siege Companion compact mode](docs/assets/compact_mode.png)

The `SZ` tile opens the current Satanic Zone details in a compact pros/cons tray. Compact mode can also sit over the game while staying small enough to keep the playfield readable.

![Hero Siege Companion compact mode over gameplay](docs/assets/full_screen_compact_mode.png)

## Past Runs

Click `End Run` to save a local summary of the current run and reset the live counters. Closing the app also saves the current run, subject to your run-history settings.

Past Runs keeps up to 100 summaries and stores only high-level stats, not packet captures.

Use `Configure Report` in Past Runs to decide which summary cards, rarity groups, tracked item groups, resource drawers, and top-drop counts should appear. Empty tracked item groups mean the report uses the default rarity-based tracking; enabled groups can focus the recap on exact items or strategies you care about.

![Hero Siege Companion past runs](docs/assets/past_runs.png)

## Loot Audio And Shopping List

The Item Filter tab lets you create sound groups for drops you care about. Groups can match by rarity, item type, or exact item name. Exact watched items can use the group sound or their own sound override.

The Shopping List keeps saved item names one click away so you can copy marketplace searches quickly from either full view or compact mode.

If developer item research is enabled in Settings, unknown item signatures appear in the Item Filter tab. You can identify them, add notes, and export a research JSON file. Names are case-normalized on save/export, and the export copy links to [GitHub Gist](https://gist.github.com/) so community findings can be shared with `sarevok9` on Reddit or `Snyne` on the Hero Siege Discord.

## Settings And Configuration

Settings are saved locally on the device. The configuration import/export controls can include app settings, past run settings, report tracking, loot filters, and optional item research data. Loot filters and item research are separate checkboxes so you can share a report setup without sharing every personal filter group.

## Required: Install Npcap

Hero Siege Companion uses the Windows packet capture driver provided by Npcap. Install Npcap before running the app.

Download Npcap from the official Nmap/Npcap site:

[https://npcap.com/](https://npcap.com/)

During setup, use these options:

- Leave **Restrict Npcap driver's access to Administrators only** unchecked.
- Check **Install Npcap in WinPcap API-compatible Mode**.
- The raw 802.11 wireless option is not required for Hero Siege Companion.

![Npcap installer options](docs/assets/npcap-install-options.svg)

If capture does not start, reinstall Npcap with the WinPcap-compatible option enabled, then restart Hero Siege Companion.

## How To Use

1. Install Npcap using the settings above.
2. Start Hero Siege.
3. Launch `Hero Siege Companion.exe`.
4. Use `Launch Game` or start Hero Siege yourself.
5. Leave capture running while you play.
6. Use timeline filters to hide noisy item categories such as keys, socketables, and materials.
7. Use the Item Filter tab to set up loot sounds for drops you care about.
8. Use `End Run` when a run is over and you want it saved to Past Runs.
9. Use `Configure Report` in Past Runs if you want run recaps to focus on specific drops or resource drawers.

The app only displays information after Hero Siege sends the relevant packet. For example, gold and mailbox state may update after changing zones or visiting town, and Satanic Zone data appears after the game sends a zone packet.

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

Build the portable Windows release:

```powershell
npm run dist:win
```

## Notes

Npcap is developed by the Nmap Project. Hero Siege Companion is not affiliated with Hero Siege, Panic Art Studios, Nmap, or Npcap.
