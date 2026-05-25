<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  id: string;
  title: string;
  panelClass?: string;
}>();

const collapsed = ref(false);
const bodyId = computed(() => `${props.id}-body`);
const toggleLabel = computed(() => `${collapsed.value ? "Expand" : "Collapse"} ${props.title}`);
</script>

<template>
  <article :class="['panel', 'live-dashboard-card', panelClass, { collapsed }]">
    <div class="panel-heading live-dashboard-card-heading">
      <div class="live-dashboard-card-title">
        <p class="eyebrow"><slot name="eyebrow"></slot></p>
        <h2 :id="`${id}-title`"><slot name="title"></slot></h2>
      </div>
      <div class="live-dashboard-card-actions">
        <slot name="actions"></slot>
        <button
          class="dashboard-card-toggle"
          type="button"
          :aria-controls="bodyId"
          :aria-expanded="!collapsed"
          :aria-label="toggleLabel"
          :title="toggleLabel"
          @click="collapsed = !collapsed"
        ></button>
      </div>
    </div>
    <div v-show="!collapsed" :id="bodyId" class="live-dashboard-card-body">
      <slot></slot>
    </div>
  </article>
</template>
