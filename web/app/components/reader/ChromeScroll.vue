<script setup lang="ts">
// The scroll's chrome (#131 phase 2; Aa → Scroll, for either style): a
// chapter is one long page. Along the top edge a lamp hairline fills as the
// chapter scrolls by, the chapter floating under it on a short veil of the
// room. Scrolling up (or a tap) brings the book page's kind of top bar (round
// glass buttons over a fade) and a bar at the bottom: where you are, the time
// left in the book, Aa. At a chapter's end a quiet pill goes on to the next
// (pulling on past the end does too).
import { runningHead, timeLeft, type ChromeInfo } from '~/utils/readerChrome'

const props = defineProps<{ shown: boolean; ready: boolean; info: ChromeInfo; nextLabel: string; search: 'capsule' | 'morph' | 'palette' }>()
defineEmits<{ back: []; contents: []; type: []; search: []; next: []; setHere: [] }>()

const { t } = useI18n()
const atChapterEnd = computed(() => props.ready && props.info.chapterFraction > 0.995)
const place = computed(() =>
  props.info.page !== null ? t('reader.page', { page: props.info.page, count: props.info.pages }) : t('reader.percent', { percent: Math.round(props.info.fraction * 100) }),
)
</script>

<template>
  <div class="edge-veil pointer-events-none fixed inset-x-0 top-0 z-10" aria-hidden="true" />
  <div class="line pointer-events-none fixed inset-x-0 z-20" :style="{ '--f': info.chapterFraction }" data-testid="reader.line" aria-hidden="true">
    <span class="fill block h-full bg-accent" />
  </div>
  <Transition name="fade">
    <p v-if="ready && !shown" class="floating eyebrow pointer-events-none fixed inset-x-0 z-20 truncate px-xxl text-center" data-testid="reader.floatingChapter">
      {{ runningHead(info.title, info.chapter) }}
    </p>
  </Transition>

  <Transition name="top">
    <header v-if="shown" class="pointer-events-none fixed inset-x-0 top-0 z-30" data-testid="reader.top">
      <div class="top-fade absolute inset-x-0 top-0" aria-hidden="true" />
      <div class="bar-top safe-x relative mx-auto max-w-(--size-max-content)">
        <div class="flex h-(--size-touch) items-center gap-xs px-inset">
          <UiRoundButton class="pointer-events-auto" icon="back" :label="t('reader.back')" data-testid="reader.back" @click="$emit('back')" />
          <span class="w-(--size-touch) shrink-0" aria-hidden="true" />
          <p class="book-title min-w-0 flex-1 truncate text-center text-callout">{{ runningHead(info.title, info.chapter) }}</p>
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
      class="glass safe-bottom fixed inset-x-0 bottom-0 z-30 border-t-(length:--stroke-hairline) border-hairline"
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
        <div class="flex items-center gap-sm pt-xs">
          <div class="min-w-0 flex-1">
            <p class="figures truncate text-caption text-ink">{{ place }}</p>
            <p class="figures truncate text-meta text-ink-faint">{{ timeLeft(t, info.minutesBook, 'book') }}</p>
          </div>
          <UiRoundButton :label="t('reader.text')" data-testid="reader.type" @click="$emit('type')">
            <span class="book-title text-body-large">A<span class="text-caption">a</span></span>
          </UiRoundButton>
        </div>
      </div>
    </footer>
  </Transition>

  <Transition name="fade">
    <div v-if="atChapterEnd && !shown" class="next fixed inset-x-0 z-20 flex justify-center">
      <UiButton tone="secondary" size="sm" class="glass" data-testid="reader.next" @click="$emit('next')">
        {{ nextLabel }}<UiIcon name="down" :size="14" />
      </UiButton>
    </div>
  </Transition>
</template>

<style scoped>
/* The room behind the status bar and the floating chapter, fading out below it. */
.edge-veil {
  height: calc(var(--bar-top) + var(--spacing-xxl));
  background: linear-gradient(var(--color-surface) calc(var(--bar-top) + var(--spacing-ml)), transparent);
}
.top-fade {
  height: calc(var(--bar-top) + var(--size-touch) + var(--spacing-lg));
  background: linear-gradient(
    to bottom,
    var(--color-surface) calc(var(--bar-top) + var(--size-touch) / 2),
    color-mix(in srgb, var(--color-surface) 88%, transparent) calc(var(--bar-top) + var(--size-touch)),
    transparent
  );
}
.flying :deep(svg) {
  visibility: hidden;
}
.line {
  top: var(--safe-area-top);
  height: var(--stroke-focus);
}
.fill {
  width: calc(var(--f) * 100%);
  transition: width var(--duration-quick) linear;
  border-radius: 0 var(--radius-pill) var(--radius-pill) 0;
}
.floating {
  top: calc(var(--bar-top) + var(--spacing-xs));
}
.next {
  bottom: var(--float-bottom);
}
.fade-enter-active {
  transition: opacity var(--duration-standard) var(--ease-standard);
}
.fade-leave-active {
  transition: opacity var(--duration-exit) var(--ease-exit);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
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
  transform: translateY(100%);
}
</style>
