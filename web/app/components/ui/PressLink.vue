<script setup lang="ts">
// A link that starts on touch-down (issue #1, story 27; NuxtBooks' pattern).
// The moment a finger or the mouse goes down, the destination's code is
// preloaded and `press` is emitted so the caller can start loading its data.
// A mouse press navigates right away; a finger navigates on the tap (its
// click), because the same touch-down may turn into a scroll. Modified clicks
// (open in a new tab) stay the browser's.
// A link to a book page knows the cover it was tapped on: as it navigates it
// hands itself to the flight, which flies that cover into the book page's
// hero (composables/useBookFlight.ts, docs/MOTION.md, Push to a book).
const props = defineProps<{ to: string }>()
const emit = defineEmits<{ press: [] }>()

const router = useRouter()
const { launch } = useBookFlight()
const href = computed(() => router.resolve(props.to).href)

// Set when a mouse press already navigated, so its click does not do it twice.
let pressed = false

function modified(event: MouseEvent) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
}

function onPointerdown(event: PointerEvent) {
  pressed = false
  if (event.button !== 0 || modified(event)) return
  emit('press')
  void preloadRouteComponents(props.to)
  if (event.pointerType === 'mouse') {
    pressed = true
    go(event.currentTarget)
  }
}

function onClick(event: MouseEvent) {
  if (event.button !== 0 || modified(event)) return
  event.preventDefault()
  if (pressed) {
    pressed = false
    return
  }
  go(event.currentTarget)
}

function go(link: EventTarget | null) {
  if (link instanceof HTMLElement) launch(link, props.to)
  void navigateTo(props.to)
}
</script>

<template>
  <a :href="href" @pointerdown="onPointerdown" @click="onClick"><slot /></a>
</template>
