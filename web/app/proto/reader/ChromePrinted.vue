<script setup lang="ts">
// c — Printed page. Where you are lives in the margins, as in a printed book:
// the chapter as a running head in the serif italic, the page as a folio in
// mono (drawn by Reader.vue into the paginator's own head and foot bands). On
// a wide screen two pages face each other across a soft gutter. So the chrome
// is only actions: a tap in the middle floats a small glass capsule up, as
// the tab bar floats elsewhere in the app — Back, Contents, the page, Aa.
import ProtoIcon from './ProtoIcon.vue'
import ProtoRound from './ProtoRound.vue'
import type { ChromeInfo } from './types'

defineProps<{ shown: boolean; info: ChromeInfo }>()
defineEmits<{ back: []; contents: []; type: []; setHere: [] }>()
</script>

<template>
  <div class="gutter pointer-events-none fixed inset-y-0 left-1/2 z-10" aria-hidden="true" />

  <Transition name="capsule">
    <div v-if="shown" class="capsule-wrap fixed inset-x-0 z-30 flex flex-col items-center gap-sm" data-testid="reader.capsule">
      <button
        v-if="info.behind"
        type="button"
        class="glass edge min-h-(--size-button-sm) rounded-pill px-md text-caption text-ink-muted shadow-float"
        data-testid="reader.setHere"
        @click="$emit('setHere')"
      >
        Your progress is at <span class="figures">p. {{ info.behind }}</span> · <span class="font-medium text-accent">Set to p. {{ info.page }}</span>
      </button>
      <nav class="capsule glass edge flex h-(--size-tab-bar) items-center gap-xxs rounded-pill px-xs shadow-float">
        <UiRoundButton icon="back" label="Back to the book" data-testid="reader.back" @click="$emit('back')" />
        <button type="button" class="figures min-h-(--size-touch) px-sm text-caption text-ink-muted" data-testid="reader.where" @click="$emit('contents')">
          {{ Math.round(info.fraction * 100) }} %<span class="text-ink-ghost"> · </span>{{ info.pages - info.page }} pages left
        </button>
        <ProtoRound label="Contents" data-testid="reader.contents" @click="$emit('contents')"><ProtoIcon name="contents" :size="20" /></ProtoRound>
        <ProtoRound label="Text and theme" data-testid="reader.type" @click="$emit('type')">
          <span class="book-title text-body-large">A<span class="text-caption">a</span></span>
        </ProtoRound>
      </nav>
    </div>
  </Transition>
</template>

<style scoped>
/* Two facing pages: a soft crease down the gutter, like the spine crease on a cover. Only when the spread shows. */
.gutter {
  display: none;
  width: var(--spacing-xxl);
  transform: translateX(-50%);
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--color-ink) 4%, transparent) 46%,
    color-mix(in srgb, var(--color-ink) 7%, transparent) 50%,
    color-mix(in srgb, var(--color-ink) 4%, transparent) 54%,
    transparent
  );
}
@media (orientation: landscape) and (min-width: 800px) {
  .gutter {
    display: block;
  }
}
.capsule-wrap {
  bottom: var(--float-bottom);
}
.capsule-enter-active {
  transition:
    opacity var(--duration-standard) var(--ease-standard),
    transform var(--duration-standard) var(--ease-standard);
}
.capsule-leave-active {
  transition:
    opacity var(--duration-exit) var(--ease-exit),
    transform var(--duration-exit) var(--ease-exit);
}
.capsule-enter-from,
.capsule-leave-to {
  opacity: 0;
  transform: translateY(var(--spacing-md));
}
</style>
