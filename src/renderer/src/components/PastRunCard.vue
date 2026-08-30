<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { PastRunSummary } from "../../../shared/stats";
import { formatDateTime, formatDuration } from "../lib/format";
import { addTag, pastRunTitle, removeTag, runTags, sameTags } from "../lib/past-run-search";
import RunTagMenu from "./RunTagMenu.vue";

const props = defineProps<{
  run: PastRunSummary;
  selected: boolean;
  allRunTags: string[];
  tagMenuOpen: boolean;
  actionMenuOpen: boolean;
}>();

const emit = defineEmits<{
  "view-report": [runId: string];
  "toggle-action-menu": [run: PastRunSummary];
  "close-action-menu": [];
  "toggle-tag-menu": [run: PastRunSummary];
  "close-tag-menu": [];
  "update-run-tags": [runId: string, tags: string[]];
  "copy-run-summary": [run: PastRunSummary];
  "export-run": [run: PastRunSummary];
  "delete-run": [runId: string];
}>();

const actionButton = ref<HTMLButtonElement | null>(null);
const actionMenu = ref<HTMLElement | null>(null);
const deleteConfirmOpen = ref(false);

watch(() => props.run.id, () => {
  deleteConfirmOpen.value = false;
});

watch(() => props.actionMenuOpen, async (isOpen, wasOpen) => {
  if (isOpen) {
    await nextTick();
    actionMenu.value?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  } else if (wasOpen) {
    deleteConfirmOpen.value = false;
    await nextTick();
    if (!props.tagMenuOpen) actionButton.value?.focus();
  }
});

watch(() => props.tagMenuOpen, async (isOpen, wasOpen) => {
  if (!isOpen && wasOpen) {
    await nextTick();
    actionButton.value?.focus();
  }
});

function addTagToRun(tag: string) {
  const nextTags = addTag(props.run, tag);
  if (sameTags(nextTags, runTags(props.run))) return;
  emit("update-run-tags", props.run.id, nextTags);
}

function removeTagFromRun(tag: string) {
  emit("update-run-tags", props.run.id, removeTag(props.run, tag));
}

function editTags() {
  emit("close-action-menu");
  emit("toggle-tag-menu", props.run);
}

function copyRunSummary() {
  emit("copy-run-summary", props.run);
  emit("close-action-menu");
}

function exportRun() {
  emit("export-run", props.run);
  emit("close-action-menu");
}

function requestDeleteRun() {
  deleteConfirmOpen.value = true;
}

function cancelDeleteRun() {
  deleteConfirmOpen.value = false;
}

function confirmDeleteRun() {
  deleteConfirmOpen.value = false;
  emit("close-action-menu");
  emit("delete-run", props.run.id);
}
</script>

<template>
  <section :class="['past-run-library-card', { selected }]">
    <button
      class="past-run-card-primary-action"
      type="button"
      :aria-current="selected ? 'page' : undefined"
      :aria-label="`Open report for ${pastRunTitle(run)}, ${formatDateTime(run.sessionStartedAt)}, ${formatDuration(run.durationMs)}`"
      @click="emit('view-report', run.id)"
    />

    <div class="past-run-card-copy">
      <h3>{{ pastRunTitle(run) }}</h3>
      <div class="past-run-meta">
        <span>{{ formatDateTime(run.sessionStartedAt) }}</span>
        <span>{{ formatDuration(run.durationMs) }}</span>
      </div>
      <div v-if="runTags(run).length" class="past-run-tags" aria-label="Run tags">
        <span v-for="tag in runTags(run)" :key="`${run.id}-${tag}`" class="run-tag-chip">
          #{{ tag }}
          <button type="button" :aria-label="`Remove ${tag} tag`" @click="removeTagFromRun(tag)">x</button>
        </span>
      </div>
    </div>

    <div class="past-run-card-actions">
      <button
        ref="actionButton"
        class="icon-button ghost icon-only past-run-more-actions"
        type="button"
        aria-haspopup="menu"
        :aria-expanded="actionMenuOpen"
        :aria-controls="`past-run-actions-${run.id}`"
        :aria-label="`More actions for ${pastRunTitle(run)}`"
        @click="emit('toggle-action-menu', run)"
      >
        <span aria-hidden="true">&hellip;</span>
      </button>
    </div>

    <div
      v-if="actionMenuOpen"
      :id="`past-run-actions-${run.id}`"
      ref="actionMenu"
      class="past-run-action-menu"
      role="menu"
      :aria-label="`Actions for ${pastRunTitle(run)}`"
      @keydown.esc.stop="emit('close-action-menu')"
    >
      <button class="past-run-copy-summary" type="button" role="menuitem" @click="copyRunSummary">Copy Summary</button>
      <button type="button" role="menuitem" @click="editTags">Edit Tags</button>
      <button class="past-run-export-single" type="button" role="menuitem" @click="exportRun">Export Run</button>
      <button v-if="!deleteConfirmOpen" class="past-run-delete" type="button" role="menuitem" @click="requestDeleteRun">Delete</button>
      <div v-else class="past-run-delete-confirm" role="group" :aria-label="`Confirm delete ${pastRunTitle(run)}`">
        <span>Delete this run?</span>
        <button class="icon-button danger past-run-confirm-delete" type="button" @click="confirmDeleteRun">Delete</button>
        <button class="icon-button ghost past-run-cancel-delete" type="button" @click="cancelDeleteRun">Cancel</button>
      </div>
    </div>

    <RunTagMenu
      v-if="tagMenuOpen"
      :id="`run-tag-menu-${run.id}`"
      :run="run"
      :all-run-tags="allRunTags"
      @add-tag="addTagToRun"
      @close="emit('close-tag-menu')"
    />
  </section>
</template>
