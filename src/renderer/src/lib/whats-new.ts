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
  version: "0.2.2",
  title: "Hero Siege Companion v0.2.2",
  intro: "Npcap is still required for capture. Install it from https://npcap.com/#download and enable WinPcap API-compatible mode during setup.",
  items: [
    "Soundpacks now export to ZIP, and ZIP imports install under a pack-named folder like soundpack1/alert.wav.",
    "Config import/export has a separate Sounds scope. When checked, sounds are embedded into config JSON and reinstalled into userData on import.",
    "Support diagnostics now has Copy Summary, clearer included/not-included copy, main-process app version metadata, and redacted shared summary paths.",
    "Past Runs now has Compare mode, JSON export for the current search/tag-matching slice, and stronger configurable recap aggregation.",
    "Added UAT-confirmed item lookup for several cards / items.",
  ],
  sections: [
    {
      title: "Soundpacks",
      items: [
        "Export imported loot alert sounds as a ZIP soundpack from Settings > Sounds.",
        "Import ZIP soundpacks into pack-named userData folders so bundled paths stay portable.",
        "Keep individual imported sound files available for rarity groups and exact watched items.",
      ],
    },
    {
      title: "Config Import And Export",
      items: [
        "Added a separate Sounds scope for configuration import and export.",
        "When Sounds is checked, exported config JSON embeds imported sounds.",
        "Config import reinstalls embedded sounds back into userData.",
      ],
    },
    {
      title: "Support Diagnostics",
      items: [
        "Added Copy Summary for quick support sharing.",
        "Clarified what diagnostics ZIPs include and do not include.",
        "Included main-process app version metadata and redacted shared summary paths.",
      ],
    },
    {
      title: "Past Runs",
      items: [
        "Added Compare mode for reviewing the recent matching slice against the full matching set.",
        "Added JSON export for the current search/tag-matching slice.",
        "Configure Report can reuse existing Item Filter groups.",
        "Custom Past Runs recap groups now support item-type rules.",
        "Report aggregation uses shared exact-item-first filter matching.",
        "Saved drop types are inferred from lookup data so report rules can classify older saved drops more reliably.",
      ],
    },
  ],
};
