<script setup lang="ts">
// A bottom sheet over the screen placed before it: a warm scrim, a paper card
// with big round shoulders, a grabber, and the title row
// (Cancel · title · trailing action).
defineProps<{ title: string; action?: string }>()
</script>

<template>
  <div class="scrim" />
  <section class="sheet c-paper-grain">
    <span class="grabber" />
    <div class="head">
      <span class="cancel">Cancel</span>
      <span class="title">{{ title }}</span>
      <span class="action" :class="{ ghosted: !action }">{{ action ?? 'Done' }}</span>
    </div>
    <div class="body"><slot /></div>
  </section>
</template>

<style scoped>
.scrim {
  position: absolute;
  inset: 0;
  z-index: 20;
  background: var(--c-scrim);
}

.sheet {
  position: absolute;
  inset: auto 0 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  padding: 0 20px calc(var(--safe-bottom) + 10px);
  border-radius: 32px 32px 0 0;
  background: var(--c-paper);
  box-shadow: 0 -12px 40px -10px rgb(var(--c-shadow) / 0.4);
}

.grabber {
  width: 40px;
  height: 5px;
  margin: 8px auto 0;
  border-radius: 999px;
  background: var(--c-line-strong);
}

.head {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  height: 50px;
  font-size: 17px;
}

.cancel {
  color: var(--c-ink-soft);
}

.title {
  font-family: var(--c-serif);
  font-size: 19px;
}

.action {
  justify-self: end;
  font-weight: 800;
  color: var(--c-accent);
}

.ghosted {
  visibility: hidden;
}

.body {
  display: flex;
  flex-direction: column;
}
</style>
