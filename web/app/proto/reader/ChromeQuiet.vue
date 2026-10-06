<script setup lang="ts">
// a — Quiet pages. While reading there is nothing on the page but the text. A
// tap in the middle brings a slim bar to the top (Back, the title, Contents)
// and one to the bottom (the progress line to scrub, the chapter, where you
// are in pages and minutes, Aa); a tap on the page, Back or Escape puts them away.
import ProtoIcon from './ProtoIcon.vue'
import ProtoRound from './ProtoRound.vue'
import Scrub from './Scrub.vue'
import { minutesLeft, type ChromeInfo } from './types'

defineProps<{ shown: boolean; info: ChromeInfo }>()
defineEmits<{ back: []; contents: []; type: []; search: []; scrub: [fraction: number]; setHere: [] }>()
</script>

<template>
  <Transition name="top">
    <!-- As on the book page (UiTopBar): round glass buttons floating over the page, no bar; a short fade of
         the room behind them keeps the title and the clock clear of the words. -->
    <header v-if="shown" class="pointer-events-none fixed inset-x-0 top-0 z-10" data-testid="reader.top">
      <div class="top-fade absolute inset-x-0 top-0" aria-hidden="true" />
      <div class="bar-top safe-x relative mx-auto max-w-(--size-max-content)">
        <div class="flex h-(--size-touch) items-center gap-xs px-inset">
        <UiRoundButton class="pointer-events-auto" icon="back" label="Back to the book" data-testid="reader.back" @click="$emit('back')" />
        <span class="w-(--size-touch) shrink-0" aria-hidden="true" />
        <p class="book-title min-w-0 flex-1 truncate text-center text-callout">{{ info.title }}</p>
        <ProtoRound class="pointer-events-auto" label="Search in the book" data-testid="reader.search" @click="$emit('search')"><ProtoIcon name="search" :size="19" /></ProtoRound>
        <ProtoRound class="pointer-events-auto" label="Contents" data-testid="reader.contents" @click="$emit('contents')"><ProtoIcon name="contents" :size="20" /></ProtoRound>
        </div>
      </div>
    </header>
  </Transition>

  <Transition name="bottom">
    <footer v-if="shown" class="glass safe-bottom fixed inset-x-0 bottom-0 z-10 border-t-(length:--stroke-hairline) border-hairline" data-testid="reader.bottom">
      <div class="mx-auto max-w-(--size-max-content) px-ml pb-xs">
        <p v-if="info.behind" class="flex items-center justify-between gap-sm pt-sm text-caption text-ink-muted">
          <span>Your progress is at <span class="figures">p. {{ info.behind }}</span>.</span>
          <button type="button" class="min-h-(--size-touch) font-medium text-accent" data-testid="reader.setHere" @click="$emit('setHere')">Set to p. {{ info.page }}</button>
        </p>
        <Scrub :fraction="info.fraction" :pages="info.pages" :saved="info.behind ? info.behind / info.pages : null" @scrub="$emit('scrub', $event)" />
        <div class="flex items-center gap-sm">
          <button type="button" class="min-w-0 flex-1 text-left" data-testid="reader.chapter" @click="$emit('contents')">
            <span class="block truncate text-caption text-ink">{{ info.chapter ?? info.title }}</span>
            <span class="figures block truncate text-meta text-ink-faint">p. {{ info.page }} of {{ info.pages }} · {{ minutesLeft(info.minutesChapter, 'chapter') }}</span>
          </button>
          <ProtoRound label="Text and theme" data-testid="reader.type" @click="$emit('type')">
            <span class="book-title text-body-large">A<span class="text-caption">a</span></span>
          </ProtoRound>
        </div>
      </div>
    </footer>
  </Transition>
</template>

<style scoped>
.top-fade {
  height: calc(var(--bar-top) + var(--size-touch) + var(--spacing-lg));
  background: linear-gradient(
    to bottom,
    var(--color-surface) calc(var(--bar-top) + var(--size-touch) / 2),
    color-mix(in srgb, var(--color-surface) 88%, transparent) calc(var(--bar-top) + var(--size-touch)),
    transparent
  );
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
