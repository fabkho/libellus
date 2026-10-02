<script setup lang="ts">
// A bottom sheet over the screen placed before it: an ink scrim, then a sheet
// of the same paper with a grabber, Cancel · title · action, a hairline, and
// the content. No shadow: the edge and the scrim do the work.
defineProps<{ title: string; action?: string; subtitle?: string }>()
</script>

<template>
  <div class="scrim" />
  <section class="sheet">
    <span class="grabber" />
    <div class="bar">
      <span class="cancel">Cancel</span>
      <span class="title">
        <span class="b-display" style="--size: 24">{{ title }}</span>
      </span>
      <span class="action" :class="{ unset: !action }">{{ action ?? 'Done' }}</span>
    </div>
    <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
    <hr class="b-rule-ink" />
    <div class="body"><slot /></div>
  </section>
</template>

<style scoped>
.scrim {
  position: absolute;
  inset: 0;
  z-index: 20;
  background: rgb(20 16 12 / 0.38);
}

.sheet {
  position: absolute;
  inset: auto 0 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  padding: 0 var(--b-margin) calc(var(--safe-bottom) + 8px);
  border-radius: 12px 12px 0 0;
  background: var(--b-paper);
}

.grabber {
  width: 36px;
  height: 5px;
  margin: 6px auto 0;
  border-radius: 3px;
  background: var(--b-rule-strong);
  opacity: 0.35;
}

.bar {
  display: grid;
  height: 48px;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
}

.cancel,
.action {
  display: flex;
  height: 44px;
  align-items: center;
  font-size: 17px;
}

.cancel {
  color: var(--b-ink-2);
}

.action {
  justify-content: flex-end;
  color: var(--b-accent);
  font-weight: 600;
}

.unset {
  visibility: hidden;
}

.title {
  padding-top: 3px;
}

.subtitle {
  margin: -6px 0 10px;
  font-size: 14px;
  font-style: italic;
  line-height: 20px;
  text-align: center;
  color: var(--b-ink-2);
}

hr {
  margin: 0;
}

.body {
  padding-top: 16px;
}
</style>
