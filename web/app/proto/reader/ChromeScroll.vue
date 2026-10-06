<script setup lang="ts">
// b — Scroll. A chapter is one long page. Along the top edge a lamp hairline
// fills as the chapter scrolls by, with the chapter's name floating under it
// on a short veil of the room. Scrolling up (or a tap) brings the bars back:
// Back, the chapter and Contents at the top; the book's progress, minutes left
// and Aa at the bottom. At a chapter's end a quiet pill goes on to the next.
import ProtoIcon from './ProtoIcon.vue'
import ProtoRound from './ProtoRound.vue'
import { minutesLeft, runningHead, type ChromeInfo } from './types'

const props = defineProps<{ shown: boolean; ready: boolean; info: ChromeInfo; nextLabel: string }>()
defineEmits<{ back: []; contents: []; type: []; next: []; setHere: [] }>()

const atChapterEnd = computed(() => props.ready && props.info.chapterFraction > 0.995)
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
    <header v-if="shown" class="bar-top glass fixed inset-x-0 top-0 z-30 border-b-(length:--stroke-hairline) border-hairline" data-testid="reader.top">
      <div class="mx-auto flex h-(--size-touch) max-w-(--size-max-content) items-center gap-xs px-inset">
        <UiRoundButton icon="back" label="Back to the book" data-testid="reader.back" @click="$emit('back')" />
        <div class="min-w-0 flex-1 text-center">
          <p class="book-title truncate text-callout">{{ info.chapter ?? info.title }}</p>
          <p class="figures truncate text-meta text-ink-faint">{{ info.title }}</p>
        </div>
        <ProtoRound label="Contents" data-testid="reader.contents" @click="$emit('contents')"><ProtoIcon name="contents" :size="20" /></ProtoRound>
      </div>
    </header>
  </Transition>

  <Transition name="bottom">
    <footer v-if="shown" class="glass safe-bottom fixed inset-x-0 bottom-0 z-30 border-t-(length:--stroke-hairline) border-hairline" data-testid="reader.bottom">
      <div class="mx-auto max-w-(--size-max-content) px-ml pb-xs">
        <p v-if="info.behind" class="flex items-center justify-between gap-sm pt-sm text-caption text-ink-muted">
          <span>Your progress is at <span class="figures">p. {{ info.behind }}</span>.</span>
          <button type="button" class="min-h-(--size-touch) font-medium text-accent" data-testid="reader.setHere" @click="$emit('setHere')">Set to p. {{ info.page }}</button>
        </p>
        <div class="flex items-center gap-sm pt-xs">
          <div class="min-w-0 flex-1">
            <p class="figures truncate text-caption text-ink">p. {{ info.page }} of {{ info.pages }} <span class="text-ink-faint">· {{ Math.round(info.fraction * 100) }} %</span></p>
            <p class="figures truncate text-meta text-ink-faint">{{ minutesLeft(info.minutesBook, 'book') }}</p>
          </div>
          <ProtoRound label="Text and theme" data-testid="reader.type" @click="$emit('type')">
            <span class="book-title text-body-large">A<span class="text-caption">a</span></span>
          </ProtoRound>
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
/* The room's colour behind the status bar and the floating chapter, fading out below it. */
.edge-veil {
  height: calc(var(--bar-top) + var(--spacing-xl));
  background: linear-gradient(var(--color-surface) 60%, transparent);
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
  color: var(--color-ink-faint);
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
  transform: translateY(-100%);
}
.bottom-enter-from,
.bottom-leave-to {
  opacity: 0;
  transform: translateY(100%);
}
</style>
