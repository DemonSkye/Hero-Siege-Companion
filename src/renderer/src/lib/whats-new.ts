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
  intro: "Version 0.3.1 adds a dedicated Market workspace with saved item filters and clearer search states. Manual SZ Refresh is temporarily unavailable while compatibility is investigated.",
  items: [
    "Search from the Market tab or a recognized drop. Choose an item, minimum sockets and known-stat minimums, then save the filters locally. Existing shopping-list entries migrate without losing their original names.",
    "Each explicit Market search shows up to 20 gold-price listings from one page. Fractional unit prices keep their precision. Loading saved filters never searches automatically; no polling, buying, alerts or automatic pagination is added.",
    "Market readiness now uses accessible ready/not-ready text and a small indicator. Missing context has in-game item-search guidance. Filter edits and account/mode changes discard stale prices while preserving the draft.",
    "Manual Satanic Zone Refresh and its sign-in settings are temporarily disabled. Passive game-observed zone effects, freshness and expiry remain visible in full and compact mode. Existing saved sign-in files are preserved.",
    "No MITMproxy, certificate installation or interception setup is required. Npcap is still required for passive capture; enable WinPcap API-compatible mode during installation.",
  ],
  sections: [],
};
