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
  intro: "Version 0.4.5 fixes kill and gold tracking on PCs whose network adapter combines large outgoing packets.",
  items: [
    "Kills now count on PCs where Windows hands large outgoing game data to the network adapter in one piece (Large Send Offload). Companion previously discarded those packets, so character saves never arrived.",
    "Gold now counts even before a character save arrives: Companion follows the gold balance that rises when you pick gold up.",
    "Deep diagnostics now mark packets that arrive in this combined form, to help with troubleshooting.",
  ],
  sections: [],
};
