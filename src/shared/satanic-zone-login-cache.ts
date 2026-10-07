/** Only fixed status categories cross IPC. No password/account/login data. */
export interface SatanicZoneLoginCacheState {
  enabled: boolean;
  unlocked: boolean;
  /** Explicit consent to retaining a locally readable unlocking key. */
  automatic?: boolean;
  status: "disabled" | "locked" | "unlocking" | "unlock_failed" | "empty" | "saved" | "unverified" | "validated" | "identity_mismatch"
    | "storage_error" | "clear_failed";
}
export const initialSatanicZoneLoginCache = (): SatanicZoneLoginCacheState => ({ enabled: false, unlocked: false, status: "disabled" });
