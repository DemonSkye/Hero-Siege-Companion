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
  intro: "This release gives the full-size companion a clearer point of view: faster live decisions, easier filter management, report-style history, and far fewer settings decisions.",
  items: [
    "Refined Live Session by removing the separate Run Command banner and moving the gear-only Dashboard fixtures customizer into the capture status row.",
    "Added a full-width collapsible Run Pace graph with pause-aware, independently scaled XP/Gold/Kills/observed-item step lanes and up to four exact item lanes from catalog suggestions or freeform names. Built-in lanes can be hidden independently, and a shared hover/keyboard inspector shows exact time and values. The live view survives tab switches, resets values for each new run, and retains lane choices; archived runs now keep a bounded Run Pace history for hoverable individual Past Run reports.",
    "Redesigned Item Filters as a collapsible Filter Stack with concise group summaries, prominent global mute, a contextual Sound Library, and previewed Filter Packs that carry only the sounds they use.",
    "Redesigned Past Runs as Report Desk, with an aggregate-first report, clickable run rows, desktop master/detail navigation, a narrow-screen Back action, contextual overflow actions, and native highlighting of matching header, stat, tag, drop, and resource data. Matching hidden report data is projected temporarily instead of appearing in a separate explainer.",
    "Rebuilt Settings as one autosaving App, Appearance, Features, Help & Support, and Developers ledger. Steam is the default launch path, built-in themes stay canonical, and advanced tools no longer crowd everyday choices.",
    "Replaced scoped configuration transfer with full backup preview and confirmation, added manual and 10-minute diagnostics modes, and separated full/compact window positions with a recovery reset.",
    "Past Runs now keeps up to 250 meaningful runs, newest first. Empty sessions are skipped without a configurable duration threshold.",
    "Retired the player-facing Item Research notebook now that the game-backed catalog resolves normal items; existing authored entries can still be exported once from Developers.",
    "Added experimental manual Satanic Zone refresh. Enable it in Settings > Features before joining a game: changing it while connected can disconnect the active game. It requests the current zone without a vote reset, is limited to once every 30 seconds, and requires mitmproxy.",
    "Patched stability issues across capture startup, packet handling, diagnostics, and native shutdown.",
    "Updated the tracked Hero Siege season number to Season 11.",
    "Added automatic item recognition using the game's own item list, so most named drops no longer need to be identified by hand.",
    "Fixed ordinary randomly generated items, including charms, being mistaken for Set items. They now show their correct base type and no longer inflate Set totals.",
    "Fixed captured item drops disappearing before they reached the timeline, including Satanic and Set items while the optional relay is active.",
    "Added the current Act 9 Satanic Zone names, so zones such as Shipwreck Cove no longer appear as raw map codes.",
    "Various bug fixes and reliability improvements.",
    "Npcap is still required for capture. Install it from https://npcap.com/#download and enable WinPcap API-compatible mode during setup.",
  ],
  sections: [],
};
