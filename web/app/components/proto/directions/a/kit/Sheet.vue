<script setup lang="ts">
// A bottom sheet, iOS 26: detached from the screen edges by 8 px with corners
// concentric to the phone's, a frosted close circle at the left and the accent
// confirm circle at the right (`confirm`; sheets with a big bottom action leave
// it out). Matte inside: the sheet is content, not chrome.
import RoundButton from './RoundButton.vue'

defineProps<{ title: string; subtitle?: string; confirm?: boolean }>()
</script>

<template>
  <div class="scrim" />
  <section class="sheet a-squircle" role="dialog" :aria-label="title">
    <span class="grabber" />
    <header class="bar">
      <RoundButton icon="close" :size="40" />
      <div class="titles">
        <span class="title">{{ title }}</span>
        <span v-if="subtitle" class="subtitle">{{ subtitle }}</span>
      </div>
      <RoundButton v-if="confirm" icon="check" accent :size="40" />
      <span v-else />
    </header>
    <div class="body"><slot /></div>
  </section>
</template>

<style scoped>
.scrim {
  position: absolute;
  inset: 0;
  z-index: 40;
  background: rgb(28 20 10 / 0.3);
}

.sheet {
  position: absolute;
  inset: auto 8px 8px;
  z-index: 41;
  display: flex;
  flex-direction: column;
  padding: 0 0 calc(var(--safe-bottom) - 6px);
  border-radius: 39px;
  background: var(--a-paper);
  box-shadow:
    0 0 0 0.5px rgb(0 0 0 / 0.06),
    0 -10px 40px -10px rgb(20 10 0 / 0.25);
}

.grabber {
  align-self: center;
  width: 36px;
  height: 5px;
  margin-top: 6px;
  border-radius: 99px;
  background: rgb(52 40 20 / 0.18);
}

.bar {
  display: grid;
  grid-template-columns: 44px 1fr 44px;
  align-items: center;
  padding: 4px 14px 6px;
}

.titles {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.2;
}

.title {
  font-size: 17px;
  font-weight: 600;
}

.subtitle {
  color: var(--a-ink-2);
  font-size: 13px;
}

.body {
  padding: 8px 18px 0;
}
</style>
