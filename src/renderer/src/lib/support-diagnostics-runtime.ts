import { computed, ref, type Ref } from "vue";
import type { CompanionState } from "../../../shared/app-state";
import { DEFAULT_SUPPORT_DIAGNOSTICS_INFO, createSupportDiagnosticsSummary } from "./support-diagnostics";

interface UseSupportDiagnosticsRuntimeOptions {
  state: Ref<CompanionState>;
  showToast: (message: string) => void;
}

export function useSupportDiagnosticsRuntime({ state, showToast }: UseSupportDiagnosticsRuntimeOptions) {
  const supportDiagnosticsInfo = ref(DEFAULT_SUPPORT_DIAGNOSTICS_INFO);
  const supportBundleBusy = ref(false);
  const supportDiagnostics = computed(() => createSupportDiagnosticsSummary(state.value, supportDiagnosticsInfo.value));

  async function refreshSupportDiagnosticsInfo() {
    try {
      supportDiagnosticsInfo.value = await window.heroSiegeCompanion.getSupportDiagnosticsInfo();
    } catch {
      supportDiagnosticsInfo.value = DEFAULT_SUPPORT_DIAGNOSTICS_INFO;
    }
  }

  async function saveSupportDiagnostics() {
    if (supportBundleBusy.value) return;
    supportBundleBusy.value = true;
    try {
      const result = await window.heroSiegeCompanion.saveSupportDiagnostics(supportDiagnostics.value);
      if (result.saved) {
        showToast(`Diagnostics ZIP saved with ${result.includedFiles.length} file${result.includedFiles.length === 1 ? "" : "s"}`);
        void refreshSupportDiagnosticsInfo();
      }
    } catch {
      showToast("Diagnostics ZIP save failed");
    } finally {
      supportBundleBusy.value = false;
    }
  }

  async function copySupportDiagnosticsSummary() {
    try {
      await window.heroSiegeCompanion.writeClipboardText(supportDiagnostics.value);
      showToast("Diagnostics summary copied");
    } catch {
      showToast("Diagnostics summary copy failed");
    }
  }

  async function openSupportLogsDirectory() {
    try {
      const opened = await window.heroSiegeCompanion.openSupportLogsDirectory();
      showToast(opened ? "Diagnostics log folder opened" : "Diagnostics log folder open failed");
      void refreshSupportDiagnosticsInfo();
    } catch {
      showToast("Diagnostics log folder open failed");
    }
  }

  async function openNpcapGuide() {
    await window.heroSiegeCompanion.openNpcapGuide();
  }

  return {
    supportDiagnosticsInfo,
    supportBundleBusy,
    supportDiagnostics,
    refreshSupportDiagnosticsInfo,
    saveSupportDiagnostics,
    copySupportDiagnosticsSummary,
    openSupportLogsDirectory,
    openNpcapGuide,
  };
}
