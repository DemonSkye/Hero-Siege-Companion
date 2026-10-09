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
  intro: "Version 0.4.3 keeps Market ready after vote resets and rebuilds compact mode around pages you can flip through.",
  items: [
    "Market remembers your account and character mode while Companion is open, so it is ready again as soon as the game sends fresh session information after a vote reset, reconnect or game restart.",
    "Compact mode shows one titled page of up to four tiles at a time. The default pages are Run, Loot and Satanic Zone, which replaces the SZ Details pop-over.",
    "Change compact pages with the mouse wheel, arrow keys, Page Up / Page Down or the page dots. Choose which inputs work in Customize Compact Mode.",
    "Customize Compact Mode now edits pages, includes presets and scrolls so every option is reachable. Existing compact layouts move to pages automatically.",
  ],
  sections: [],
};
