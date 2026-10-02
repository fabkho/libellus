<script setup lang="ts">
// A cover set like a plate in a printed issue: the image at its own aspect
// ratio (Apple's 600×900 boxes hold 503–600 px wide artwork, so never forced to
// 2:3), a hairline edge, and an optional frame and caption.
//
// Size by `width` (height follows the artwork) or by `height` (width follows,
// for shelf strips). While loading, and for the Placeholder cover, the box is
// 2:3. The Placeholder cover is an Insel-style label: title and author on a
// paper label over the accent colour.
import { computed } from 'vue'
import { formatAuthors } from '../../../data'

const props = defineProps<{
  book: { title: string; authors: string[]; coverUrl: string | null }
  width?: number
  height?: number
  /** Frame the cover with a passe-partout, like a plate. */
  plate?: boolean
  /** Caption under the plate, set small. */
  caption?: string
}>()

// `aspect-ratio: auto 2/3` = 2:3 until the image is in, then its own ratio.
const box = computed(() =>
  props.height ? { height: `${props.height}px`, width: 'auto' } : { width: `${props.width ?? 80}px`, height: 'auto' },
)
const placeholderSize = computed(() => {
  const w = props.width ?? Math.round((props.height ?? 120) / 1.5)
  return { w, title: Math.max(7, w / 7.2), author: Math.max(5.5, w / 15) }
})
</script>

<template>
  <figure class="cover" :class="{ plate }">
    <div class="frame">
      <img
        v-if="book.coverUrl"
        :src="book.coverUrl"
        :alt="book.title"
        class="image"
        :style="box"
      />
      <div
        v-else
        class="placeholder"
        :style="{
          width: `${placeholderSize.w}px`,
          height: `${Math.round(placeholderSize.w * 1.5)}px`,
        }"
      >
        <div class="label">
          <span class="title" :style="{ fontSize: `${placeholderSize.title}px` }">{{ book.title }}</span>
          <span class="rule" />
          <span class="author" :style="{ fontSize: `${placeholderSize.author}px` }">{{ formatAuthors(book.authors) }}</span>
        </div>
      </div>
    </div>
    <figcaption v-if="caption" class="caption">{{ caption }}</figcaption>
  </figure>
</template>

<style scoped>
.cover {
  display: inline-flex;
  flex-direction: column;
  flex-shrink: 0;
  margin: 0;
}

.frame {
  position: relative;
  display: flex;
}

.plate .frame {
  padding: 6px;
  border: 1px solid var(--b-rule);
  background: var(--b-paper);
}

.image {
  display: block;
  max-width: none;
  aspect-ratio: auto 2 / 3;
  background: var(--b-paper-2);
  /* A hairline inside the edge, so white covers don't melt into the paper. */
  outline: 1px solid rgb(0 0 0 / 0.12);
  outline-offset: -1px;
}


.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 11% 9%;
  background: var(--b-accent);
}

.label {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: center;
  gap: 0.35em;
  padding: 14% 8%;
  background: var(--b-paper);
  color: var(--b-ink);
  text-align: center;
}

.title {
  font-family: var(--b-display);
  font-style: italic;
  line-height: 1.02;
  text-wrap: balance;
  overflow-wrap: anywhere;
}

.rule {
  width: 26%;
  border-top: 1px solid var(--b-accent);
}

.author {
  font-family: var(--b-text);
  font-weight: 600;
  letter-spacing: 0.12em;
  line-height: 1.2;
  text-transform: uppercase;
}

.caption {
  margin-top: 6px;
  font-family: var(--b-text);
  font-size: 11px;
  font-style: italic;
  line-height: 16px;
  color: var(--b-ink-2);
}
</style>
