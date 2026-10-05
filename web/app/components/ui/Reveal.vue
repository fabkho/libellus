<script setup lang="ts">
// Something that is not there until it has something to say (issue #79: the
// book page's figures, chart and log before any progress was tracked). When
// `show` turns on, it opens its room and fades in over `standard`, so what sits
// under it glides down instead of jumping; it closes over `exit`. Clipped only
// while it moves, so focus rings and touch areas are never cut. With Reduce
// Motion it is a short fade and no travel (docs/MOTION.md). Attributes (the
// test id) land on the room's element. While it moves it carries `data-moving`,
// like a list's room, so the flows tap only once what sits under it has landed.
defineProps<{ show: boolean }>()

const moving = ref(false)
</script>

<template>
  <Transition
    name="reveal"
    @before-enter="moving = true"
    @after-enter="moving = false"
    @enter-cancelled="moving = false"
    @before-leave="moving = true"
    @after-leave="moving = false"
    @leave-cancelled="moving = false"
  >
    <div v-if="show" class="reveal grid" :data-moving="moving || undefined">
      <!-- min-w-0: content wider than the column (a row that scrolls sideways) scrolls inside it, never widens the room. -->
      <div class="min-h-0 min-w-0">
        <slot />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.reveal {
  grid-template-rows: 1fr;
}
.reveal-enter-active > div,
.reveal-leave-active > div {
  overflow: hidden;
}
.reveal-enter-active {
  transition:
    grid-template-rows var(--duration-standard) var(--ease-standard),
    opacity var(--duration-standard) var(--ease-standard);
}
.reveal-leave-active {
  transition:
    grid-template-rows var(--duration-exit) var(--ease-exit),
    opacity var(--duration-exit) var(--ease-exit);
}
.reveal-enter-from,
.reveal-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .reveal-enter-active,
  .reveal-leave-active {
    transition: opacity var(--duration-quick) linear;
  }
}
</style>
