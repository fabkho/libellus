<script setup lang="ts">
// A cover at a fixed width and the book's 2:3 shape. The image is never
// stretched (object-fit: cover), sits on a quiet placeholder tone while it
// loads, and gets a printed-book finish: a faint spine crease on the left and
// a hairline edge. `halo` puts a blurred copy behind it — the lamp light the
// cover throws (hidden by the Cover glow toggle). No image → the Placeholder
// cover: cloth-bound, title and author set in type, a thin inset rule.
import { computed } from 'vue'
import { formatAuthors } from '../../../data'
import { clothOf } from './night'

const props = withDefaults(
  defineProps<{
    book: { title: string; authors: string[]; coverUrl: string | null }
    width: number
    halo?: boolean
    radius?: number
  }>(),
  { halo: false, radius: 0 },
)

const height = computed(() => Math.round(props.width * 1.5))
const r = computed(() => props.radius || (props.width >= 100 ? 5 : props.width >= 60 ? 3.5 : 2.5))
</script>

<template>
  <div class="k-cover" :style="{ width: `${width}px`, height: `${height}px` }">
    <img v-if="halo && book.coverUrl" :src="book.coverUrl" alt="" class="d-halo halo" aria-hidden="true" />
    <div class="sheet" :style="{ borderRadius: `${r}px` }">
      <img v-if="book.coverUrl" :src="book.coverUrl" :alt="book.title" class="image" />
      <div
        v-else
        class="cloth"
        :style="{ background: clothOf(book.title), padding: `${Math.max(5, width * 0.1)}px ${Math.max(5, width * 0.09)}px` }"
      >
        <span class="rule" :style="{ inset: `${Math.max(3, width * 0.05)}px` }" />
        <span class="title" :style="{ fontSize: `${Math.max(5, width * 0.125)}px` }">{{ book.title }}</span>
        <span class="mark" :style="{ width: `${Math.max(6, width * 0.14)}px` }" />
        <span class="author" :style="{ fontSize: `${Math.max(3.5, width * 0.068)}px` }">{{
          formatAuthors(book.authors)
        }}</span>
      </div>
      <span class="finish" />
    </div>
  </div>
</template>

<style scoped>
.k-cover {
  position: relative;
  flex-shrink: 0;
}

.halo {
  position: absolute;
  inset: 8% -6% -10%;
  width: 112%;
  height: 102%;
  object-fit: cover;
  filter: blur(26px) saturate(1.5);
  opacity: var(--d-halo-k);
  transform: translateZ(0);
  pointer-events: none;
}

.sheet {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: linear-gradient(160deg, var(--d-fill-2), var(--d-fill));
  box-shadow: var(--d-cover-shadow);
}

.image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Spine crease and a hairline edge, so a white cover still has a border on
   paper and a dark cover still has an edge in the dark. */
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
  box-shadow: inset 0 0 0 0.5px rgb(255 255 255 / 0.12);
  pointer-events: none;
}

.cloth {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  text-align: center;
  color: #f1e3c8;
}

.rule {
  position: absolute;
  border: 0.5px solid rgb(241 227 200 / 0.35);
  border-radius: 1px;
}

.title {
  margin-top: 18%;
  font-family: var(--d-serif);
  font-weight: 500;
  line-height: 1.12;
  letter-spacing: -0.005em;
  overflow-wrap: break-word;
  hyphens: manual;
}

.mark {
  height: 0.5px;
  margin: 9% 0;
  background: rgb(241 227 200 / 0.55);
}

.author {
  font-family: var(--d-sans);
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.78;
}
</style>
