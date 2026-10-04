import { computed, ref, watch, type Ref } from "vue";
import type { CompanionState } from "../../../shared/app-state";
import { isSatanicZoneDiagnosticActive } from "../../../shared/satanic-zone-diagnostic";

export function useSatanicZoneDiagnosticRuntime(options: { state: Ref<CompanionState>; showToast(message: string): void }) {
  const arming = ref(false);
  const cancelling = ref(false);
  let operation = 0;
  let stateVersion = 0;
  watch(() => options.state.value.satanicZoneDiagnostic, () => { stateVersion++; }, { flush: "sync" });

  async function armSatanicZoneDiagnostic(): Promise<void> {
    if (arming.value || cancelling.value || isSatanicZoneDiagnosticActive(options.state.value.satanicZoneDiagnostic)) return;
    const current = ++operation;
    const initialStateVersion = stateVersion;
    arming.value = true;
    try {
      const diagnostic = await window.heroSiegeCompanion.armSatanicZoneDiagnostic();
      if (current === operation && stateVersion === initialStateVersion) options.state.value = { ...options.state.value, satanicZoneDiagnostic: diagnostic };
    } catch {
      if (current === operation) options.showToast("SZ diagnostic could not be armed");
    } finally { if (current === operation) arming.value = false; }
  }

  async function cancelSatanicZoneDiagnostic(): Promise<void> {
    if (cancelling.value) return;
    const current = ++operation;
    const initialStateVersion = stateVersion;
    arming.value = false;
    cancelling.value = true;
    try {
      const diagnostic = await window.heroSiegeCompanion.cancelSatanicZoneDiagnostic();
      if (current === operation && stateVersion === initialStateVersion) options.state.value = { ...options.state.value, satanicZoneDiagnostic: diagnostic };
    } catch {
      if (current === operation) options.showToast("SZ diagnostic cancellation could not be confirmed");
    } finally { if (current === operation) cancelling.value = false; }
  }

  return { szDiagnosticBusy: computed(() => arming.value || cancelling.value), szDiagnosticCancelBusy: cancelling,
    armSatanicZoneDiagnostic, cancelSatanicZoneDiagnostic };
}
