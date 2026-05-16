# Hero Siege Companion

Electron + Vue MVP for passive Hero Siege stat tracking.

## Capture Dependency

This app uses Node `cap`, which requires Npcap on Windows.

Install Npcap with:

- `Install Npcap in WinPcap API-compatible Mode`
- `Restrict Npcap driver's access to Administrators only` unchecked

## First Setup In This Workspace

The old `cap` native module does not build cleanly through normal `npm install` on this machine. Use the same proven path from the capture spike:

```powershell
$env:npm_config_cache='.npm-cache'
npm install --ignore-scripts
```

```powershell
$env:electron_config_cache=(Join-Path (Get-Location) '.electron-cache')
node .\node_modules\electron\install.js
```

```powershell
$env:npm_config_python='C:\Program Files\JetBrains\JetBrains Rider 2023.1.3\plugins\cidr-debugger-plugin\bin\lldb\win\x64\bin\python.exe'
npx electron-rebuild -f -w cap
```

## Run

```powershell
npm start
```
