export const HIDEABLE_LIVE_DASHBOARD_FIXTURES = ["item-timeline", "live-log", "player-chat"] as const;

export type HideableLiveDashboardFixture = (typeof HIDEABLE_LIVE_DASHBOARD_FIXTURES)[number];

export function isHideableLiveDashboardFixture(value: unknown): value is HideableLiveDashboardFixture {
  return typeof value === "string"
    && HIDEABLE_LIVE_DASHBOARD_FIXTURES.includes(value as HideableLiveDashboardFixture);
}

export function normalizeHiddenDashboardFixtures(value: unknown): HideableLiveDashboardFixture[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(String).filter(isHideableLiveDashboardFixture)));
}
