<script setup lang="ts">
// A link that starts on touch-down (issue #1, story 27; NuxtBooks' pattern).
// The moment a finger or the mouse goes down, the destination's code is
// preloaded and `press` is emitted so the caller can start loading its data.
// A mouse press navigates right away; a finger navigates on the tap (its
// click), because the same touch-down may turn into a scroll. Modified clicks
// (open in a new tab) stay the browser's.
// A link to a book page knows the cover it was tapped on: as it navigates it
// hands itself to the flight, which flies that cover into the book page's
// hero (composables/useBookFlight.ts, docs/MOTION.md, Push to a book), and on
// the press it starts loading that hero's image, so the cover lands sharp.
// A part of the link marked `data-press-to` (a row's author line, #167) goes
// to its own address instead: tapped there, the row opens the author's page,
// with no flight; the link itself (keyboard, assistive tech) stays the Book's.
const props = defineProps<{ to: string }>()
const emit = defineEmits<{ press: [] }>()

const router = useRouter()
const { launch, prepare } = useBookFlight()
const href = computed(() => router.resolve(props.to).href)

// Set when a mouse press already navigated, so its click does not do it twice.
let pressed = false

function modified(event: MouseEvent) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
}

/** The address of the part of the link the event is on, if that part goes elsewhere. */
function partTo(event: Event): string | null {
  const part = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-press-to]') : null
  if (!part || !(event.currentTarget instanceof Element) || !event.currentTarget.contains(part)) return null
  return part.dataset.pressTo || null
}

function onPointerdown(event: PointerEvent) {
  pressed = false
  if (event.button !== 0 || modified(event)) return
  const part = partTo(event)
  if (part) {
    void preloadRouteComponents(part)
    if (event.pointerType === 'mouse') {
      pressed = true
      void navigateTo(part)
    }
    return
  }
  emit('press')
  void preloadRouteComponents(props.to)
  if (event.currentTarget instanceof HTMLElement) prepare(event.currentTarget, props.to)
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
  const part = partTo(event)
  if (part) void navigateTo(part)
  else go(event.currentTarget)
}

function go(link: EventTarget | null) {
  if (link instanceof HTMLElement) launch(link, props.to)
  void navigateTo(props.to)
}
</script>

<template>
  <a :href="href" @pointerdown="onPointerdown" @click="onClick"><slot /></a>
</template>
