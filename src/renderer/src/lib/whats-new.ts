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
  intro: "Npcap is still required for capture. Install it from https://npcap.com/#download and enable WinPcap API-compatible mode during setup.",
  items: [
    "Past Runs now has CSV export, Discord-friendly summary copy, per-run tags, delete controls with confirmations, expanded detail rows, report presets, linked Item Filter groups, top-drop limits, and resource drawers.",
    "Appearance settings now include Demonsteel, Voidglass, Reliquary, Cyberpunk, and Quicksilver themes with separate full/compact choices, accent colors, texture controls, foreground fill, and theme import/export.",
    "Item Research can filter, classify, export scoped review data, clear resolved or ignored rows, and separate generated placeholders from missing-icon follow-up work.",
    "Capture startup now keeps the app open with a clear Npcap/native-capture error when the native capture module cannot load.",
    "Settings, What's New, Item Filter confirmation, and Past Runs report dialogs now contain keyboard focus and restore the opener after close.",
    "Support diagnostics, soundpacks, and configuration import/export have clearer local-first flows with redacted summaries and optional embedded sounds.",
  ],
  sections: [
    {
      title: "Past Runs",
      items: [
        "Export the current search or tag-matching run set as JSON or CSV.",
        "Copy Discord-friendly summaries for filtered aggregates or individual saved runs.",
        "Use report presets, linked Item Filter groups, custom recap groups, top-drop limits, and resource drawers to shape run recaps.",
        "Tag saved runs and expand a run row to inspect matching drops or resources without leaving Past Runs.",
        "Delete one saved run or clear the full Past Runs archive from the history view after confirmation.",
      ],
    },
    {
      title: "Themes And Appearance",
      items: [
        "Choose from Dark, Demonsteel, Voidglass, Reliquary, Cyberpunk, and Quicksilver full-app and compact themes.",
        "Tune accent colors, background textures, and foreground fill separately for full and compact modes.",
        "Export the current appearance setup or a starter theme template for custom theme work.",
      ],
    },
    {
      title: "Item Research",
      items: [
        "Filter research entries by status, type, and rarity.",
        "Export all, resolved-only, or unresolved-only research data for maintainer review.",
        "Classify unknown normal items, stack items, materials, and generated placeholders while keeping app-icon gaps as maintainer backlog.",
        "Clear resolved or ignored rows after review without disturbing active unknowns.",
      ],
    },
    {
      title: "Capture And Support",
      items: [
        "Keep the app shell running when the native capture module cannot load, with Npcap setup guidance instead of a startup crash.",
        "Copy a redacted support summary and save a local diagnostics ZIP without writing packet capture files.",
        "Export imported loot alert sounds as ZIP soundpacks, or include sounds in configuration JSON only when the Sounds scope is selected.",
        "Keep settings and release dialogs keyboard-contained with focus restoration when they close.",
      ],
    },
  ],
};
