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
  intro: "Version 0.4.4 fixes kill tracking for some characters and makes explainers and the Live Log easier to read.",
  items: [
    "Kills and XP now count for characters whose save data contains escaped text, for example a quote or slash in a mercenary or inventory tab name. Those saves were previously ignored.",
    "Switching characters during a run no longer adds the difference between the two characters' lifetime kills and XP to the run.",
    "Player chat that mentions mail no longer turns on the mail indicator.",
    "Explainer bubbles, such as those on Gold and Kills, now appear above everything else and stay inside the window.",
    "Live Log entries stay readable in narrow layouts, and hovering an entry shows its full text.",
  ],
  sections: [],
};
