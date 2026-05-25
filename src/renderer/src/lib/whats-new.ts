export interface WhatsNewRelease {
  version: string;
  title: string;
  items: string[];
}

export const WHATS_NEW_RELEASE: WhatsNewRelease = {
  version: "0.2.0",
  title: "Audio, Themes, And Run Tools",
  items: [
    "Past Runs now has search across tags, drops, resources, characters, and run stats, plus per-run tags you can select or create from saved history.",
    "Configurable Past Runs reports with summary cards, rarity filters, tracked item groups, resource drawers, and top-drop limits.",
    "Compact and full dashboards now share customizable run tiles, including custom counters tied to loot filter groups or exact items.",
    "Loot alert audio is much more flexible: import local sound files or zip soundpacks, then use them on rarity groups or exact watched items.",
    "Imported sounds live in Settings > Sounds, appear in Item Filter sound menus, and can be removed when you are done with them.",
    "Theme support now includes built-in Dark, Cyberpunk, and Light themes, separate full-app and compact mode choices, and configurable accent colors.",
    "Theme import/export lets you share a base theme, accent color, and optional app chrome tokens while keeping rarity colors game-matched.",
    "Npcap setup checks now surface common capture prerequisites before a silent capture failure.",
    "Run pause and resume now works across compact and full views, and capture stops pause the current run instead of skewing rates.",
    "Cyberpunk theme polish adds a warmer left-side glow and smoother animated panel highlights.",
  ],
};
