<script setup lang="ts">
import type { SupportDiagnosticGeneratedFileInfo, SupportDiagnosticLogFileInfo } from "../../../shared/support-diagnostics";

defineProps<{
  supportDiagnostics: string;
  supportGeneratedFiles: SupportDiagnosticGeneratedFileInfo[];
  supportLogFiles: SupportDiagnosticLogFileInfo[];
  supportLogsPath: string;
  supportBundleBusy: boolean;
}>();

defineEmits<{
  saveSupportDiagnostics: [];
}>();

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString();
}
</script>

<template>
  <div class="settings-grid settings-grid-single">
    <section class="settings-wide compact-settings-section">
      <div class="compact-settings-heading">
        <strong>Diagnostics bundle</strong>
        <button class="icon-button ghost" type="button" :disabled="supportBundleBusy" @click="$emit('saveSupportDiagnostics')">
          {{ supportBundleBusy ? "Preparing ZIP" : "Save ZIP" }}
        </button>
      </div>
      <p class="settings-note settings-wide-note">Save this when asking for capture help. The ZIP includes the current capture summary and local diagnostics logs.</p>
      <p class="settings-note settings-wide-note settings-support-path">Log folder: <code>{{ supportLogsPath }}</code></p>
      <div class="settings-support-files" aria-label="Diagnostics files">
        <div v-for="file in supportGeneratedFiles" :key="file.name" class="settings-support-file">
          <div>
            <strong>{{ file.name }}</strong>
            <span>{{ file.description }}</span>
          </div>
          <small class="settings-support-file-status">Generated</small>
        </div>
        <div v-for="file in supportLogFiles" :key="file.name" class="settings-support-file" :class="{ missing: !file.exists }">
          <div>
            <strong>{{ file.name }}</strong>
            <span>{{ file.description }}</span>
            <code>{{ file.path }}</code>
          </div>
          <small class="settings-support-file-status">
            {{ file.exists ? formatBytes(file.sizeBytes) : "Missing" }}
            <span v-if="file.updatedAt">{{ formatUpdatedAt(file.updatedAt) }}</span>
          </small>
        </div>
      </div>
      <div class="compact-settings-heading settings-support-preview-heading">
        <strong>Preview</strong>
        <span>diagnostics-summary.txt</span>
      </div>
      <pre class="settings-support-bundle">{{ supportDiagnostics }}</pre>
    </section>
  </div>
</template>
