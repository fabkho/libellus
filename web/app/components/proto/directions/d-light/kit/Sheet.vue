<script setup lang="ts">
// A bottom sheet the iOS way: the screen underneath (slot `under`) steps back —
// scaled, dimmed, rounded — and the sheet rises over it with a grabber and a
// title row (Cancel · title · action).
withDefaults(defineProps<{ title: string; action?: string; cancel?: string }>(), { cancel: 'Cancel' })
</script>

<template>
  <div class="k-stage">
    <div class="under" aria-hidden="true"><slot name="under" /></div>
    <div class="scrim" />
    <section class="sheet" role="dialog" :aria-label="title">
      <span class="grabber" />
      <div class="head">
        <span class="side">{{ cancel }}</span>
        <span class="title">{{ title }}</span>
        <span class="side end" :class="{ hidden: !action }">{{ action ?? 'Done' }}</span>
      </div>
      <div class="body"><slot /></div>
    </section>
  </div>
</template>

<style scoped>
.k-stage {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: var(--dl-stage);
}

.under {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: 14px;
  background: var(--dl-bg);
  transform: translateY(16px) scale(0.92);
  transform-origin: 50% 0;
}

.scrim {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 0.5);
}

.sheet {
  position: absolute;
  inset: auto 0 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  padding: 0 20px calc(var(--safe-bottom) + 10px);
  border-radius: 30px 30px 0 0;
  background: var(--dl-sheet);
  box-shadow:
    inset 0 0.5px 0 var(--dl-line-2),
    0 -20px 50px rgb(0 0 0 / 0.4);
}

.grabber {
  width: 36px;
  height: 5px;
  margin: 7px auto 0;
  border-radius: 999px;
  background: var(--dl-ink-4);
}

.head {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  height: 48px;
  align-items: center;
}

.side {
  font-size: 15.5px;
  color: var(--dl-ink-2);
}

.end {
  justify-self: end;
  font-weight: 600;
  color: var(--dl-lamp);
}

.hidden {
  visibility: hidden;
}

.title {
  font-size: 15.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
</style>
