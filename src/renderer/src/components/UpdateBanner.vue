<script setup lang="ts">
import type { ReleaseUpdateInfo } from "../../../shared/app-state";

defineProps<{
  update: ReleaseUpdateInfo;
}>();

defineEmits<{
  open: [];
  ignore: [];
}>();
</script>

<template>
  <section class="update-banner" aria-live="polite">
    <div>
      <strong>Release {{ update.version }} is now available</strong>
      <span>{{ update.name }}</span>
    </div>
    <div class="update-actions">
      <button class="icon-button primary" type="button" @click="$emit('open')">Update</button>
      <button class="icon-button ghost" type="button" @click="$emit('ignore')">Ignore</button>
    </div>
  </section>
</template>
