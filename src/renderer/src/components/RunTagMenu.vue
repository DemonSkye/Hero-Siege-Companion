<script setup lang="ts">
import { computed, ref } from "vue";
import { MAX_PAST_RUN_TAGS, type PastRunSummary } from "../../../shared/stats";
import {
  availableTagOptions,
  canCreateTag,
  pendingTag,
  runTags,
} from "../lib/past-run-search";

const props = defineProps<{
  run: PastRunSummary;
  allRunTags: string[];
}>();

const emit = defineEmits<{
  addTag: [tag: string];
  close: [];
}>();

const tagDraft = ref("");
const tagOptions = computed(() => availableTagOptions(props.allRunTags, props.run, tagDraft.value));
const canCreate = computed(() => canCreateTag(props.run, tagDraft.value));
const pending = computed(() => pendingTag(tagDraft.value));

function addTag(tag: string) {
  emit("addTag", tag);
  tagDraft.value = "";
}
</script>

<template>
  <div class="run-tag-menu" role="menu" aria-label="Run tags" @keydown.esc="emit('close')">
    <div class="run-tag-menu-head">
      <strong>Select tag</strong>
      <button type="button" title="Close tag picker" aria-label="Close tag picker" @click="emit('close')">x</button>
    </div>
    <label class="run-tag-search">
      <span>Search</span>
      <input v-model="tagDraft" type="search" placeholder="Search or create a new tag" autocomplete="off" spellcheck="false" @keydown.enter.prevent="canCreate ? addTag(pending) : null" />
    </label>
    <div class="run-tag-options">
      <button v-for="tag in tagOptions" :key="`${run.id}-option-${tag}`" class="run-tag-option" type="button" role="menuitem" @click="addTag(tag)">
        #{{ tag }}
      </button>
      <button v-if="canCreate" class="run-tag-option create" type="button" role="menuitem" @click="addTag(pending)">
        Create #{{ pending }}
      </button>
      <p v-else-if="runTags(run).length >= MAX_PAST_RUN_TAGS" class="empty-copy">Tag limit reached for this run.</p>
      <p v-else-if="tagDraft.trim() && !tagOptions.length" class="empty-copy">No available tag matches.</p>
      <p v-else-if="!tagOptions.length" class="empty-copy">No saved tags yet. Type a new one to create it.</p>
    </div>
  </div>
</template>
