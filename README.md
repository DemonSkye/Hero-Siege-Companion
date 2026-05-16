# Hero Siege Companion

Passive live-session tracking for Hero Siege on Windows.

Hero Siege Companion watches local Hero Siege traffic, parses the game messages it understands, and turns the useful bits into a compact live dashboard: session time, gold and XP rates, mailbox status, Satanic Zone details, tracked drops, item history, and capture diagnostics.

![Hero Siege Companion preview](docs/assets/app.png)

## Features

- Live capture status with packet and parse counts.
- Session timer, character name, gold earned, XP earned, and per-hour rates.
- Mailbox state detection from game packets.
- Satanic Zone name, reset countdown, pros, and cons.
- Tracked drop counters for Set, Satanic, Heroic, and Angelic items.
- Item timeline with filters for item type, keys, socketables, materials, and material-like collectibles.
- Diagnostics panel for parsed events and capture troubleshooting.
- Local-only desktop app: no account login, no cloud service, and no packet capture files are written by the app.

## Download

Download the latest Windows build from the GitHub Releases page:

[Hero Siege Companion Releases](https://github.com/DemonSkye/Hero-Siege-Companion/releases)

The release asset is the portable Windows build. Download it, unzip it if needed, and run `Hero Siege Companion.exe`.

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
4. Leave the companion running while you play.
5. Use the timeline filters to hide noisy item categories such as keys, socketables, and materials.

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

Rebuild the native packet capture module:

```powershell
$env:npm_config_python='C:\Program Files\JetBrains\JetBrains Rider 2023.1.3\plugins\cidr-debugger-plugin\bin\lldb\win\x64\bin\python.exe'
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
