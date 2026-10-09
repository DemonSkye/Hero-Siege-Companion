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
  intro: "Version 0.4.2 shows Market listing stats for many more items, including most unique weapons, amulets, rings, belts and flasks, and names the weapon base stats.",
  items: [
    "Listing cards now show rolled stats for most unique weapons, amulets, rings, belts and flasks, which previously showed every field as unavailable. Only fields that still can't be verified, such as some socket rolls, stay hidden.",
    "Weapon base stats have names: Base Attack Damage, Base Attacks per Second and Base Attack Range, replacing Stat 22, Stat 23 and Stat 24.",
    "Items whose rolls can't be read yet show one clear line instead of a long list of unavailable fields.",
  ],
  sections: [],
};
