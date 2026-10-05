<script setup lang="ts">
// A year in review's Books as Regal's 3D Stack (#23), for the owner only (the
// page renders it for her alone, stores/shelf.ts): the Books of the library
// file finished that year, a separator per month, in a window onto the night
// room under the months. A picture, not a place to browse: the page scrolls
// over it (a pile that took the finger would trap the scroll), and a tap, or
// Open, takes the year full screen (Your shelf with `?year=`), where it can be
// browsed and its Books taken out.
//
// The 3D is fetched only once the window comes near the view (Regal and
// three.js are the `regal` chunk, `LazyShelfStage`); until it has drawn, the
// year's Books stand as a pile of slabs in their Spines' colours.
import type { ShelfBook } from '~/data/shelf'

const props = defineProps<{ year: number; books: readonly ShelfBook[] }>()
const { t } = useI18n()
const { count } = useFigures()

const to = computed(() => ({ path: '/profile/shelf', query: { year: String(props.year) } }))

// Near the view (a screen above or below it): time to fetch the 3D.
const frame = ref<HTMLElement | null>(null)
const near = ref(false)
const ready = ref(false)
let observer: IntersectionObserver | null = null
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') return void (near.value = true)
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      near.value = true
      observer?.disconnect()
    },
    { rootMargin: '100% 0px' },
  )
  if (frame.value) observer.observe(frame.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <section id="shelf" :aria-label="t('shelf.year.title')" class="flex flex-col gap-md" data-testid="yearInReview.shelf">
    <div class="flex h-(--size-button-sm) items-center justify-between gap-md">
      <h2 class="eyebrow">
        {{ t('shelf.year.title') }}
        <span class="figures ml-xs text-ink-ghost" data-testid="yearInReview.shelfCount">{{ count(books.length) }}</span>
      </h2>
      <UiButton tone="quiet" size="sm" :to="to" :aria-label="t('shelf.year.openLabel', { year, count: count(books.length) }, books.length)" data-testid="yearInReview.shelfOpen">
        {{ t('shelf.year.open') }}<UiIcon name="chevron" :size="13" />
      </UiButton>
    </div>

    <div ref="frame">
      <NuxtLink
        :to="to"
        data-theme="dark"
        class="window relative block overflow-hidden rounded-lg bg-surface shadow-raised edge-faint active:opacity-80"
        tabindex="-1"
        aria-hidden="true"
        data-testid="yearInReview.shelfWindow"
      >
        <!-- Regal's Stack starts with the top of the pile in the middle of its view, to be scrolled
             through; here nothing scrolls, so its view reaches above the window and the pile stands in it. -->
        <span v-if="near" class="lift pointer-events-none absolute inset-x-0 bottom-0">
          <LazyShelfStage :year="year" inert class="room-3d" :class="ready && 'ready'" @ready="ready = true" />
        </span>
        <Transition name="hand-over">
          <span v-if="!ready" class="absolute inset-0 flex items-center justify-center px-xxl">
            <ShelfPile :books="books" :limit="14" class="w-full" />
          </span>
        </Transition>
      </NuxtLink>
    </div>
  </section>
</template>

<style scoped>
.window {
  aspect-ratio: 4 / 5;
}
.lift {
  top: -60%;
}
.room-3d {
  opacity: 0;
  transition: opacity var(--duration-standard) var(--ease-standard);
}
.room-3d.ready {
  opacity: 1;
}
.hand-over-leave-active {
  transition: opacity var(--duration-standard) var(--ease-standard);
}
.hand-over-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .room-3d,
  .hand-over-leave-active {
    transition: none;
  }
}
</style>
