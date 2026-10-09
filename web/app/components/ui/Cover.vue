<script setup lang="ts">
// A Book's cover in the book's 2:3 shape at one of the token widths. The image
// is never stretched (object-fit: cover). While it loads it sits on its
// thumbhash, or on its dominant colour, or on a quiet fill; it fades in once
// decoded. It gets a printed-book finish: a faint spine crease on the left and
// a hairline edge, so a white cover has an edge on paper and a dark one in the
// dark. `glow` puts the lamp light behind it: a blurred copy of the image, or,
// until there is one, a pool in the cover's own precomputed colours.
// No image (or a broken one) → the Placeholder cover: cloth-bound, title and
// author set in type, a thin inset rule (CONTEXT.md, Placeholder cover). The
// type is clamped to what fits (a long title steps down in size and ends in an
// ellipsis, the author in two lines), and under `md` there is no type at all:
// at 30–40 px it is noise, so the cloth, the rule and the mark carry it. The
// title stays in the accessible name. `fallback` tells the parent when the
// Placeholder is showing (the page's glow then takes the cloth's colour).
// The sheet (`data-cover`: image or cloth, without the glow) is what flies
// between a list and the book page (composables/useBookFlight.ts).
// `fallbacks` are tried in turn when the image fails or comes back blank (a
// source's 1 × 1 stand-in), before the Placeholder. Once an image is in view
// it stays: a later `src` of another artwork or a fallback never swaps it
// unless it fails (utils/cover.ts, `CoverShowing`; docs/covers.md).
// `whole` (an ebook file's own cover, #131: files carry covers of any shape):
// an image clearly off the book's 2:3 (more than WHOLE_TOLERANCE either way)
// is shown whole, fitted into the slot (object-fit: contain), on a blurred
// copy of itself, so the slot is filled in the cover's own colours and no
// letter of its title is cut off. A cover near 2:3 fills the slot as always.
import {
  coverFailed,
  coverInputChanged,
  coverNow,
  coverShown,
  coverSizes,
  coverSrcset,
  isBlankCover,
  startCover,
  type CoverColors,
} from '~/utils/cover'

const props = withDefaults(
  defineProps<{
    title: string
    authors?: readonly string[]
    src?: string | null
    /** The images to try, in order, after `src` fails or is blank. */
    fallbacks?: readonly string[]
    /**
     * What the cover is of: an edition's ISBN, say. While an image of it is in view, a new `src` of
     * another artwork (a re-synced cover, a fallback) does not replace it, unless it fails; another
     * `identity` is a deliberate change of cover and does. Default: the title and authors.
     */
    identity?: string
    thumbhash?: string | null
    colors?: CoverColors | null
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
    glow?: boolean
    /** For the first covers on screen: load now instead of when scrolled near. */
    eager?: boolean
    /** For the covers the member sees first: asked for ahead of every other image. */
    priority?: boolean
    /**
     * The title is written right beside it, in the same row or link: the cover adds nothing for
     * assistive tech and is left out (empty alt), so a link does not read "Dune Dune Frank Herbert".
     * A cover on its own (Want to read's row) keeps the title as its name.
     */
    decorative?: boolean
    /** Show an image of another shape whole (fitted, on a blurred copy of itself) instead of cropping it. */
    whole?: boolean
  }>(),
  { authors: () => [], src: null, fallbacks: () => [], thumbhash: null, colors: null, size: 'sm', glow: false, eager: false, priority: false, decorative: false, whole: false },
)

/** How far an image's shape may be from 2:3 (as a share of it) and still fill the slot when `whole`. */
const WHOLE_TOLERANCE = 0.08

const emit = defineEmits<{ fallback: [value: boolean] }>()

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
/** The showing image is of another shape than 2:3 and `whole`: fitted, not cropped. */
const fitted = ref(false)
/** What shows: `src`, then each of `fallbacks` after one that failed or came back blank; an image in view stays (`CoverShowing`). */
const identityKey = computed(() => props.identity ?? `${props.title}\n${props.authors.join('\n')}`)
const input = () => ({ src: props.src, fallbacks: props.fallbacks, identity: identityKey.value })
const showing = ref(startCover(input()))
const current = computed(() => coverNow(showing.value))
const attempt = computed(() => showing.value.attempt)

/** Without an image in view the cover starts over (not loaded, not fitted). */
function settle() {
  if (showing.value.shown !== null) return
  loaded.value = false
  fitted.value = false
}

// The fallbacks are a new array on every render of a parent: it is what is in them that counts.
watch(
  () => [props.src ?? '', props.fallbacks.join('\n'), identityKey.value].join('\0'),
  () => {
    showing.value = coverInputChanged(showing.value, input())
    settle()
  },
)

function failed(image: HTMLImageElement) {
  showing.value = coverFailed(showing.value, image.currentSrc || image.src)
  // A size of what was in view failing: it loads again from the size that loaded, and fades in again.
  loaded.value = false
  if (showing.value.shown === null) fitted.value = false
}

// An Apple cover offers its sizes (`srcset`, by width) and says what width it renders at (`sizes`), so
// the browser takes the narrowest sharp one. The halo and the backing say the same, so all three are one download.
const imageSet = computed(() => {
  const srcset = attempt.value === 0 && showing.value.srcset ? coverSrcset(current.value, props.size) : null
  return { src: current.value!, srcset: srcset ?? undefined, sizes: srcset ? coverSizes(props.size) : undefined }
})

const showImage = computed(() => Boolean(current.value))
watch(showImage, (shown) => emit('fallback', !shown), { immediate: true })

// Loaded is not drawn: Safari paints a large image only once it is decoded, so
// a fade that starts on `load` shows the thumbhash through for its first
// frames, then the image pops in half way. The fade starts once it is decoded
// (and the halo, the same image, fades in with it).
function onLoad(event: Event) {
  const image = event.target as HTMLImageElement
  // A blank stand-in (OpenLibrary's 1×1 "no cover") moves on to the next source.
  if (isBlankCover(image.naturalWidth, image.naturalHeight)) return failed(image)
  showing.value = coverShown(showing.value, image.currentSrc || image.src)
  fitted.value = props.whole && Math.abs(image.naturalWidth / image.naturalHeight / (2 / 3) - 1) > WHOLE_TOLERANCE
  const shown = current.value
  const reveal = () => {
    if (current.value === shown) loaded.value = true
  }
  image.decode().then(reveal, reveal)
}

/** Under `md` the Placeholder is cloth, rule and mark only. */
const compact = computed(() => props.size === 'xs' || props.size === 'sm')
/** A longer title is set smaller (and clamped to more lines), so it fits whole where it can. */
const titleTier = computed(() => (props.title.length <= 36 ? 'short' : props.title.length <= 70 ? 'medium' : 'long'))

// What shows under the image while it loads. Data, not design: the colours and
// the thumbhash are the cover's own.
const underlay = computed(() => {
  const hash = thumbhashDataUrl(props.thumbhash)
  if (hash) return { backgroundImage: `url(${hash})`, backgroundSize: 'cover' }
  if (props.colors) return { backgroundColor: props.colors.dominant }
  return {}
})

// The pool behind the cover: in the cover's own colours, or in the cloth's
// while the Placeholder shows (a broken image's colours would light the wrong room).
const glowStyle = computed(() => {
  if (!showImage.value) return { '--pool-a': `color-mix(in srgb, ${cloth.value} 55%, white)`, '--pool-b': cloth.value }
  const glow = glowOf(props.colors)
  return { '--pool-a': `rgb(${glow.a})`, '--pool-b': `rgb(${glow.b})` }
})

const cloth = computed(() => `var(--color-cloth${clothOf(props.title)})`)
const authorLine = computed(() => formatAuthors(props.authors, t('common.etAl')))
</script>

<template>
  <div class="relative shrink-0 aspect-2/3" :class="WIDTHS[size]">
    <template v-if="glow">
      <img v-if="showImage" v-bind="imageSet" alt="" class="halo" :class="!loaded && 'out'" :loading="eager ? 'eager' : 'lazy'" aria-hidden="true" />
      <span class="pool" :class="showImage && loaded && 'out'" :style="glowStyle" aria-hidden="true" />
    </template>

    <div class="sheet relative size-full overflow-hidden shadow-cover" :class="RADII[size]" :style="underlay" data-cover>
      <!-- Behind a fitted image only; the fitted image is positioned to paint over it. A cover that fills its slot stays unpositioned, as the flight expects. -->
      <img v-if="showImage && fitted" v-bind="imageSet" alt="" class="backing" :class="loaded ? 'opacity-100' : 'opacity-0'" aria-hidden="true" />
      <img
        v-if="showImage"
        v-bind="imageSet"
        :alt="decorative ? '' : title"
        :loading="eager ? 'eager' : 'lazy'"
        :fetchpriority="priority ? 'high' : undefined"
        decoding="async"
        class="block size-full transition-opacity duration-(--duration-standard) ease-standard"
        :class="[loaded ? 'opacity-100' : 'opacity-0', fitted ? 'relative object-contain' : 'object-cover']"
        :data-fitted="fitted || undefined"
        @load="onLoad"
        @error="failed($event.target as HTMLImageElement)"
      />
      <div
        v-else
        class="cloth"
        :class="compact && 'compact'"
        :style="{ background: cloth }"
        :role="decorative ? undefined : 'img'"
        :aria-label="decorative ? undefined : title"
        :aria-hidden="decorative || undefined"
      >
        <span class="rule" />
        <template v-if="compact">
          <span class="mark" />
        </template>
        <template v-else>
          <span class="cloth-title" :class="`tier-${titleTier}`">{{ title }}</span>
          <span class="mark" />
          <span v-if="authorLine" class="cloth-author">{{ authorLine }}</span>
        </template>
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
  transition: opacity var(--duration-standard) var(--ease-standard);
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
  transition: opacity var(--duration-standard) var(--ease-standard);
  inset: -12% -24%;
  background:
    radial-gradient(50% 46% at 50% 52%, color-mix(in srgb, var(--pool-a) 55%, transparent), transparent 72%),
    radial-gradient(40% 30% at 80% 20%, color-mix(in srgb, var(--pool-b) 30%, transparent), transparent 70%);
  filter: blur(calc(var(--blur-halo) / 2));
  opacity: var(--opacity-halo);
  pointer-events: none;
}

/* The halo fades in with the image it is made of; the pool it replaces fades out. */
.halo.out,
.pool.out {
  opacity: 0;
}

/* Behind a cover shown whole: the same image, filling the slot and blurred to its colours. */
.backing {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(calc(var(--blur-halo) / 4)) saturate(1.2);
  transform: scale(1.25);
  transition: opacity var(--duration-standard) var(--ease-standard);
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

/* No type: the mark sits in the middle of the cloth. */
.cloth.compact {
  justify-content: center;
}

.compact .mark {
  margin: 0;
}

.rule {
  position: absolute;
  inset: max(3px, 5cqi);
  border: var(--stroke-hairline) solid color-mix(in srgb, var(--color-cloth-ink) 35%, transparent);
  border-radius: 1px;
}

.cloth-title {
  min-width: 0;
  max-width: 100%;
  margin-top: 18%;
  font-family: var(--font-serif);
  font-size: max(5px, 12.5cqi);
  font-weight: var(--font-weight-medium);
  line-height: 1.12;
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  display: -webkit-box;
  -webkit-line-clamp: 4;
}

/* Heights in cqi: cover 150, minus padding 20, the title's top margin 18, the
   mark 18 and two author lines 16 leaves 78 for the title: 4 × 14, 6 × 11.8, 8 × 9.5. */
.tier-medium {
  font-size: max(5px, 10.5cqi);
  -webkit-line-clamp: 6;
}

.tier-long {
  font-size: max(5px, 8.5cqi);
  -webkit-line-clamp: 8;
}

.mark {
  width: max(6px, 14cqi);
  height: var(--stroke-hairline);
  flex-shrink: 0;
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
  flex-shrink: 0;
  max-width: 100%;
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  display: -webkit-box;
  -webkit-line-clamp: 2;
}
</style>
