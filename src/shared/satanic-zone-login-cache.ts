/** Only fixed status categories cross IPC. No account/build/login data. */
export interface SatanicZoneLoginCacheState {
  enabled: boolean;
  status: "disabled" | "empty" | "saved" | "unverified" | "validated" | "identity_mismatch"
    | "build_unavailable" | "build_mismatch" | "encryption_unavailable" | "storage_error" | "clear_failed";
}
export const initialSatanicZoneLoginCache = (): SatanicZoneLoginCacheState => ({ enabled: false, status: "disabled" });
