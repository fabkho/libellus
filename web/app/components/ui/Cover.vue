<script setup lang="ts">
// A Book's cover in the book's 2:3 shape at one of the token widths. The image
// is never stretched (object-fit: cover). While it loads it sits on its
// thumbhash, or on its dominant colour, or on a quiet fill; it fades in once
// decoded. It gets a printed-book finish: a faint spine crease on the left and
// a hairline edge, so a white cover has an edge on paper and a dark one in the
// dark. `glow` puts the lamp light behind it: a blurred copy of the image, or,
// until there is one, a pool in the cover's own precomputed colours.
// No image (or a broken one) → the Placeholder cover: cloth-bound, title and
// author set in type, a thin inset rule (CONTEXT.md, Placeholder cover).
import type { CoverColors } from '~/utils/cover'

const props = withDefaults(
  defineProps<{
    title: string
    authors?: readonly string[]
    src?: string | null
    thumbhash?: string | null
    colors?: CoverColors | null
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
    glow?: boolean
    /** For the first covers on screen: load now instead of when scrolled near. */
    eager?: boolean
  }>(),
  { authors: () => [], src: null, thumbhash: null, colors: null, size: 'sm', glow: false, eager: false },
)

const { t } = useI18n()

const WIDTHS = {
  xs: 'w-(--size-cover-xs)',
  sm: 'w-(--size-cover-sm)',
  md: 'w-(--size-cover-md)',
  lg: 'w-(--size-cover-lg)',
  xl: 'w-(--size-cover-xl)',
} as const
// Small covers get small corners; a big one a printed book's softer edge.
const RADII = { xs: 'rounded-cover-sm', sm: 'rounded-cover-sm', md: 'rounded-cover', lg: 'rounded-cover', xl: 'rounded-cover-lg' } as const

const loaded = ref(false)
const failed = ref(false)
watch(
  () => props.src,
  () => {
    loaded.value = false
    failed.value = false
  },
)

const showImage = computed(() => Boolean(props.src) && !failed.value)

// What shows under the image while it loads. Data, not design: the colours and
// the thumbhash are the cover's own.
const underlay = computed(() => {
  const hash = thumbhashDataUrl(props.thumbhash)
  if (hash) return { backgroundImage: `url(${hash})`, backgroundSize: 'cover' }
  if (props.colors) return { backgroundColor: props.colors.dominant }
  return {}
})

const glowStyle = computed(() => {
  const glow = glowOf(props.colors)
  return { '--glow-a': glow.a, '--glow-b': glow.b }
})

const cloth = computed(() => `var(--color-cloth${clothOf(props.title)})`)
const authorLine = computed(() => formatAuthors(props.authors, t('common.etAl')))
</script>

<template>
  <div class="relative shrink-0 aspect-2/3" :class="WIDTHS[size]">
    <template v-if="glow">
      <img v-if="showImage && loaded" :src="src!" alt="" class="halo" aria-hidden="true" />
      <span v-else class="pool" :style="glowStyle" aria-hidden="true" />
    </template>

    <div class="sheet relative size-full overflow-hidden shadow-cover" :class="RADII[size]" :style="underlay">
      <img
        v-if="showImage"
        :src="src!"
        :alt="title"
        :loading="eager ? 'eager' : 'lazy'"
        decoding="async"
        class="block size-full object-cover transition-opacity duration-(--duration-standard) ease-standard"
        :class="loaded ? 'opacity-100' : 'opacity-0'"
        @load="loaded = true"
        @error="failed = true"
      />
      <div v-else class="cloth" :style="{ background: cloth }" role="img" :aria-label="title">
        <span class="rule" />
        <span class="cloth-title">{{ title }}</span>
        <span class="mark" />
        <span class="cloth-author">{{ authorLine }}</span>
      </div>
      <span class="finish" aria-hidden="true" />
    </div>
  </div>
</template>

<style scoped>
/* Placeholder type scales with the cover: everything in container units. */
.sheet {
  container-type: inline-size;
  background-image: linear-gradient(160deg, var(--color-fill-strong), var(--color-fill));
}

.halo {
  position: absolute;
  inset: 8% -6% -10%;
  width: 112%;
  height: 102%;
  object-fit: cover;
  filter: blur(var(--blur-halo)) saturate(1.5);
  opacity: var(--opacity-halo);
  transform: translateZ(0);
  pointer-events: none;
}

.pool {
  position: absolute;
  inset: -12% -24%;
  background:
    radial-gradient(50% 46% at 50% 52%, rgb(var(--glow-a) / 0.55), transparent 72%),
    radial-gradient(40% 30% at 80% 20%, rgb(var(--glow-b) / 0.3), transparent 70%);
  filter: blur(calc(var(--blur-halo) / 2));
  opacity: var(--opacity-halo);
  pointer-events: none;
}

/* Spine crease and a hairline edge. The crease is light and shadow on the
   cover itself, the same in both themes. */
.finish {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    rgb(0 0 0 / 0.22) 0,
    rgb(255 255 255 / 0.1) 1.6%,
    rgb(0 0 0 / 0.06) 3.5%,
    transparent 7%
  );
  box-shadow: inset 0 0 0 var(--stroke-hairline) rgb(255 255 255 / 0.12);
  pointer-events: none;
}

.cloth {
  position: relative;
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: center;
  padding: max(5px, 10cqi) max(5px, 9cqi);
  overflow: hidden;
  text-align: center;
  color: var(--color-cloth-ink);
}

.rule {
  position: absolute;
  inset: max(3px, 5cqi);
  border: var(--stroke-hairline) solid color-mix(in srgb, var(--color-cloth-ink) 35%, transparent);
  border-radius: 1px;
}

.cloth-title {
  margin-top: 18%;
  font-family: var(--font-serif);
  font-size: max(5px, 12.5cqi);
  font-weight: var(--font-weight-medium);
  line-height: 1.12;
  overflow-wrap: break-word;
}

.mark {
  width: max(6px, 14cqi);
  height: var(--stroke-hairline);
  margin: 9% 0;
  background: color-mix(in srgb, var(--color-cloth-ink) 55%, transparent);
}

.cloth-author {
  font-size: max(3.5px, 6.8cqi);
  font-weight: var(--font-weight-medium);
  line-height: 1.2;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.78;
}
</style>
