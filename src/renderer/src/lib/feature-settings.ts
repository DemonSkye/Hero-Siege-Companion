import { ACTIVE_SATANIC_ZONE_REFRESH_ENABLED } from "../../../shared/release-features";

// Register each feature control's presentation gate here. The panel and its
// navigation use these same gates, so future visible controls restore the section.
export const FEATURE_SETTINGS_VISIBILITY = {
  satanicZoneRefresh: ACTIVE_SATANIC_ZONE_REFRESH_ENABLED,
} as const;

export const HAS_VISIBLE_FEATURE_SETTINGS = Object.values(FEATURE_SETTINGS_VISIBILITY).some(Boolean);
