<script setup lang="ts">
const launchThroughSteam = defineModel<boolean>("launchThroughSteam", { required: true });
const gameExecutablePath = defineModel<string>("gameExecutablePath", { required: true });

defineEmits<{
  chooseGameExecutable: [];
}>();
</script>

<template>
  <div class="settings-ledger-panel-heading">
    <h2>App</h2>
    <p>Choose how the companion launches Hero Siege.</p>
  </div>

  <section class="settings-ledger-section" aria-labelledby="settings-game-launch-title">
    <div class="settings-ledger-section-heading">
      <h3 id="settings-game-launch-title">Game launch</h3>
      <p>Steam is recommended. Standalone installs can point directly to the game executable.</p>
    </div>

    <div class="settings-ledger-row">
      <div class="settings-ledger-copy">
        <span id="settings-launch-method-label" class="settings-ledger-title">Launch game with</span>
        <p>Used by the Launch Game button when capture is stopped.</p>
      </div>
      <fieldset class="settings-choice-group" aria-labelledby="settings-launch-method-label">
        <legend class="sr-only">Launch game with</legend>
        <label>
          <input v-model="launchThroughSteam" type="radio" :value="true" />
          <span>Steam</span>
        </label>
        <label>
          <input v-model="launchThroughSteam" type="radio" :value="false" />
          <span>Standalone</span>
        </label>
      </fieldset>
    </div>

    <div v-if="!launchThroughSteam" class="settings-ledger-row settings-ledger-child-row">
      <div class="settings-ledger-copy">
        <label class="settings-ledger-title" for="settings-game-executable">Game executable</label>
        <p>Select the Hero Siege executable used by this installation.</p>
      </div>
      <div class="settings-ledger-control settings-path-control">
        <input
          id="settings-game-executable"
          v-model="gameExecutablePath"
          type="text"
          spellcheck="false"
          autocomplete="off"
          placeholder="Choose Hero_Siege.exe"
        />
        <button class="icon-button ghost" type="button" @click="$emit('chooseGameExecutable')">Browse…</button>
      </div>
    </div>
  </section>
</template>
