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
  intro: "Version 0.4.0 makes Market searches item-aware and shows the stats on each listing, and tightens capture reliability and app security. Manual SZ Refresh remains temporarily unavailable while compatibility is investigated.",
  items: [
    "Market listings show each item's rolled stats where the roll can be reconstructed and verified. Fields that can't be verified are marked rather than guessed.",
    "Choosing an item now shapes the filters: minimum and maximum sockets with the item's base socket range, runewords searched by their native ID, and stat minimums with verified names. Less-proven stats are labelled experimental.",
    "The chosen item's stat ranges sit beside the filters, with a placeholder until an item is picked, so the form no longer jumps. Picking a new item or a Timeline drop starts a fresh draft.",
    "Market readiness stays trustworthy after capture interruptions: lost or out-of-order game traffic retires stale session information instead of reusing it, while healthy game connections keep working. An in-game Market search or vote reset collects fresh information.",
    "Security hardening: game launch only uses the executable you approved, exports can't overwrite the app or its settings, downloads started from the app window are blocked, and app requests are only accepted from the main window.",
    "Faster processing of long game messages, and the item catalog now ships as reusable data files.",
    "Manual Satanic Zone Refresh and its sign-in settings stay disabled. Passive zone effects, freshness and expiry remain visible, and existing saved sign-in files are preserved. Npcap is still required for passive capture.",
  ],
  sections: [],
};
