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
  sections: [
    {
      title: "Also new in 0.4.1",
      items: [
        "Stat filters are compact rows showing the stat name, your minimum, and the item's base range for that stat. The stat search box no longer stretches across the page, and its suggestions open as a dropdown without pushing the page down.",
        "Add a stat filter straight from the base stats card with its + button. Stats you are already filtering on are highlighted.",
        "Socket minimum and maximum sit on one row with the item's base socket range.",
        "Price results are cards: item and variant at the top, stats in one column with each value next to its name, and the price at the bottom. Cards wrap to fit the window, and prices line up across each row.",
        "The Market layout adapts to medium and narrow windows: panels stack when there isn't room side by side, and values no longer break across lines.",
      ],
    },
  ],
};
