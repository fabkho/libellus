<script setup lang="ts">
// One cover of the sign-in wall (components/auth/Frame.vue), drawn on a canvas rather than shown as an <img>.
// The wall is decoration, but on a phone one of its covers was the page's largest contentful paint: an
// <img> of 82 px (100 × 134 with the tilt) is a bigger candidate than the wordmark (10,168 px²), so LCP
// moved from the form's 2.1 s to the moment the first cover arrived, 5.6 s (docs/perf/final-round.md,
// finding 1). A canvas is not an LCP candidate; the cover still comes over the network, from the same URL,
// at low priority, and `object-fit: cover` is done by hand here. Not announced (the wall is aria-hidden)
// and not focusable. It fades in over the board when it has been drawn (docs/MOTION.md, Sign-in wall); with
// Reduce Motion it is there at once. If the image fails, nothing is drawn and the board shows.
const props = defineProps<{ src: string }>()
const emit = defineEmits<{ failed: [] }>()

// The size of the `lg` cover (240 × 360, utils/cover.ts): the bitmap the canvas is drawn at.
const WIDTH = 240
const HEIGHT = 360

const canvas = ref<HTMLCanvasElement>()
const drawn = ref(false)

onMounted(() => {
  const image = new Image()
  // Read with CORS, deliberately: the worker keeps every cover asked for without it (`libellus-covers`,
  // nuxt.config.ts, `request.mode === 'no-cors'`), and the wall is decoration on a screen nobody is signed in
  // on — it would put sixteen catalogue covers into the member's cache right after signing out emptied it
  // (e2e/device-data.spec.ts). A CORS read goes to the network, as a thumbhash's does. Apple sends
  // `access-control-allow-origin: *`; were it ever to stop, nothing is drawn and the board shows.
  image.crossOrigin = 'anonymous'
  image.decoding = 'async'
  image.fetchPriority = 'low'
  image.onload = () => {
    const context = canvas.value?.getContext('2d')
    if (!context || !image.naturalWidth) return emit('failed')
    // object-fit: cover: the largest 2 : 3 window of the picture, centred.
    const scale = Math.max(WIDTH / image.naturalWidth, HEIGHT / image.naturalHeight)
    const [sw, sh] = [WIDTH / scale, HEIGHT / scale]
    context.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, 0, 0, WIDTH, HEIGHT)
    drawn.value = true
  }
  image.onerror = () => emit('failed')
  image.src = props.src
})
</script>

<template>
  <canvas ref="canvas" class="cover" :class="{ 'cover-in': drawn }" :width="WIDTH" :height="HEIGHT" />
</template>

<style scoped>
/* The real cover over its board; the board shows until it is drawn, or when it fails. */
.cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  opacity: 0;
  transition: opacity var(--duration-standard) var(--ease-standard);
}

.cover-in {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .cover {
    transition: none;
  }
}
</style>
