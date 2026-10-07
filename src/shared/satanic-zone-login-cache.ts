/** Only fixed status categories cross IPC. No password/account/login data. */
export interface SatanicZoneLoginCacheState {
  enabled: boolean;
  unlocked: boolean;
  /** Explicit consent to retaining a locally readable unlocking key. */
  automatic?: boolean;
  /** Generic mode label only; account identifiers stay in main. */
  accountLabel?: "Saved standard account" | "Saved beta account";
  status: "disabled" | "locked" | "unlocking" | "unlock_failed" | "empty" | "saved" | "loaded" | "route_required"
    | "storage_error" | "clear_failed";
}
export const initialSatanicZoneLoginCache = (): SatanicZoneLoginCacheState => ({ enabled: false, unlocked: false, status: "disabled" });
