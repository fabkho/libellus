<script setup lang="ts">
// The classic reader's chrome (#131 phase 2; Classic mode): nothing on the
// page while reading. A tap in the middle floats the book page's kind of top
// bar in — round glass buttons (Back; Search, Contents) and the title, over a
// short fade of the room, no bar — and a bar at the bottom: the progress line
// to drag to a place, the chapter, where you are in pages and minutes, Aa.
// The search palette grows out of the bottom bar (Search.vue).
import Scrub from './Scrub.vue'
import { timeLeft, type ChromeInfo } from '~/utils/readerChrome'

defineProps<{ shown: boolean; info: ChromeInfo; search: 'capsule' | 'morph' | 'palette' }>()
defineEmits<{ back: []; contents: []; type: []; search: []; scrub: [fraction: number]; setHere: [] }>()

const { t } = useI18n()
</script>

<template>
  <Transition name="top">
    <header v-if="shown" class="pointer-events-none fixed inset-x-0 top-0 z-10" data-testid="reader.top">
      <div class="top-fade absolute inset-x-0 top-0" aria-hidden="true" />
      <div class="bar-top safe-x relative mx-auto max-w-(--size-max-content)">
        <div class="flex h-(--size-touch) items-center gap-xs px-inset">
          <UiRoundButton class="pointer-events-auto" icon="back" :label="t('reader.back')" data-testid="reader.back" @click="$emit('back')" />
          <span class="w-(--size-touch) shrink-0" aria-hidden="true" />
          <p class="book-title min-w-0 flex-1 truncate text-center text-callout">{{ info.title }}</p>
          <UiRoundButton
            class="pointer-events-auto"
            :class="search === 'morph' && 'flying'"
            icon="search"
            :label="t('reader.search')"
            data-reader-morph="search"
            data-testid="reader.search"
            @click="$emit('search')"
          />
          <UiRoundButton class="pointer-events-auto" icon="contents" :label="t('reader.contents')" data-testid="reader.contents" @click="$emit('contents')" />
        </div>
      </div>
    </header>
  </Transition>

  <Transition name="bottom">
    <footer
      v-if="shown"
      class="glass safe-bottom fixed inset-x-0 bottom-0 z-10 border-t-(length:--stroke-hairline) border-hairline"
      :class="search === 'palette' && 'invisible'"
      data-reader-morph="capsule"
      data-testid="reader.bottom"
    >
      <div class="mx-auto max-w-(--size-max-content) px-ml pb-xs" data-reader-morph="item">
        <p v-if="info.behind" class="flex items-center justify-between gap-sm pt-sm text-caption text-ink-muted">
          <span>{{ t('reader.behind', { page: info.behind }) }}</span>
          <button type="button" class="min-h-(--size-touch) font-medium text-accent" data-testid="reader.setHere" @click="$emit('setHere')">
            {{ t('reader.setHere', { page: info.page !== null ? t('reader.pageOnly', { page: info.page }) : t('reader.percent', { percent: Math.round(info.fraction * 100) }) }) }}
          </button>
        </p>
        <Scrub :fraction="info.fraction" :pages="info.pages" :saved="null" @scrub="$emit('scrub', $event)" />
        <div class="flex items-center gap-sm">
          <button type="button" class="min-w-0 flex-1 text-left" data-testid="reader.chapter" @click="$emit('contents')">
            <span class="block truncate text-caption text-ink">{{ info.chapter ?? info.title }}</span>
            <span class="figures block truncate text-meta text-ink-faint">
              <template v-if="info.page !== null">{{ t('reader.page', { page: info.page, count: info.pages }) }}</template>
              <template v-else>{{ t('reader.percent', { percent: Math.round(info.fraction * 100) }) }}</template>
              · {{ timeLeft(t, info.minutesChapter, 'chapter') }}
            </span>
          </button>
          <UiRoundButton :label="t('reader.text')" data-testid="reader.type" @click="$emit('type')">
            <span class="book-title text-body-large">A<span class="text-caption">a</span></span>
          </UiRoundButton>
        </div>
      </div>
    </footer>
  </Transition>
</template>

<style scoped>
/* As on the book page: no bar, a short fade of the room behind the round buttons keeps the title and the clock clear. */
.top-fade {
  height: calc(var(--bar-top) + var(--size-touch) + var(--spacing-lg));
  background: linear-gradient(
    to bottom,
    var(--color-surface) calc(var(--bar-top) + var(--size-touch) / 2),
    color-mix(in srgb, var(--color-surface) 88%, transparent) calc(var(--bar-top) + var(--size-touch)),
    transparent
  );
}
/* While the palette's own magnifier flies, this one stays hidden (one icon on screen). */
.flying :deep(svg) {
  visibility: hidden;
}
.top-enter-active,
.bottom-enter-active {
  transition:
    opacity var(--duration-standard) var(--ease-standard),
    transform var(--duration-standard) var(--ease-standard);
}
.top-leave-active,
.bottom-leave-active {
  transition:
    opacity var(--duration-exit) var(--ease-exit),
    transform var(--duration-exit) var(--ease-exit);
}
.top-enter-from,
.top-leave-to {
  opacity: 0;
  transform: translateY(calc(-1 * var(--spacing-sm)));
}
.bottom-enter-from,
.bottom-leave-to {
  opacity: 0;
  transform: translateY(var(--spacing-sm));
}
</style>
