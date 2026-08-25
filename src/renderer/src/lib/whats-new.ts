import { APP_VERSION } from "./app-version";

export interface WhatsNewRelease {
  version: string;
  title: string;
  intro: string;
  items: string[];
  sections: WhatsNewSection[];
}

export interface WhatsNewSection {
  title: string;
  items: string[];
}

export const WHATS_NEW_RELEASE: WhatsNewRelease = {
  version: APP_VERSION,
  title: `Hero Siege Companion v${APP_VERSION}`,
  intro: "This release keeps Hero Siege Companion aligned with the new season and introduces an experimental way to refresh Satanic Zone details in-world.",
  items: [
    "Added experimental manual Satanic Zone refresh. Enable it in Settings > Capture before joining a game: enabling or disabling it while connected will disconnect the game in progress. It requests the current zone without a vote reset, is limited to once every 30 seconds, and requires mitmproxy.",
    "Patched stability issues across capture startup, packet handling, diagnostics, and native shutdown.",
    "Updated the tracked Hero Siege season number to Season 11.",
    "Fixed generated item handling so ambiguous charm rarity codes no longer inflate Set totals or trigger manual Identify tasks, while named Satanic and Set charms keep their correct rarity.",
    "Various bug fixes and reliability improvements.",
    "Npcap is still required for capture. Install it from https://npcap.com/#download and enable WinPcap API-compatible mode during setup.",
  ],
  sections: [],
};
