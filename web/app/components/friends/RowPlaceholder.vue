<script setup lang="ts">
// A row of the social screens while its list loads (docs/MOTION.md, Loading), at the height of the
// row that will take its place:
//  - `feed`   a feed entry (FriendsFeedRow): its `md` cover, then the avatar and name, the title and
//             the authors as lines of text;
//  - `person` a People row (FriendsPersonRow): the avatar and the name;
//  - `day`    the eyebrow of a day's section.
// `wave` is its place in the loading wave. Hidden from assistive tech: there is nothing to read yet
// (the list around it says `aria-busy`).
withDefaults(defineProps<{ kind: 'feed' | 'person' | 'day'; wave?: number }>(), { wave: 0 })
</script>

<template>
  <div v-if="kind === 'feed'" class="flex items-start gap-ml py-ms" aria-hidden="true">
    <span class="cover skeleton wave" :style="{ '--wave': wave }" />
    <span class="flex min-w-0 flex-1 flex-col items-start gap-xxs">
      <span class="avatar-line flex items-center gap-sm">
        <span class="avatar skeleton wave rounded-pill" :style="{ '--wave': wave + 0.03 }" />
        <span class="line subhead"><span class="skeleton wave w-(--spacing-xxl)" :style="{ '--wave': wave + 0.05 }" /></span>
      </span>
      <span class="line callout w-full"><span class="skeleton wave w-3/5" :style="{ '--wave': wave + 0.1 }" /></span>
      <span class="line caption w-full"><span class="skeleton wave w-2/5" :style="{ '--wave': wave + 0.15 }" /></span>
    </span>
  </div>
  <span v-else-if="kind === 'day'" class="line eyebrow-line" aria-hidden="true"><span class="skeleton wave w-1/6" :style="{ '--wave': wave }" /></span>
  <div v-else class="flex min-h-(--size-row) items-center gap-ms py-xs" aria-hidden="true">
    <span class="avatar skeleton wave rounded-pill" :style="{ '--wave': wave }" />
    <span class="line body flex-1"><span class="skeleton wave w-2/5" :style="{ '--wave': wave + 0.05 }" /></span>
  </div>
</template>

<style scoped>
/* A feed row's cover: UiCover `md`. */
.cover {
  flex-shrink: 0;
  width: var(--size-cover-md);
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-cover);
}
.avatar {
  flex-shrink: 0;
  width: var(--size-avatar);
  height: var(--size-avatar);
}
.avatar-line {
  height: var(--size-avatar);
}
/* A line of text: its line height, with a bar about as tall as its letters. */
.line {
  display: flex;
  align-items: center;
}
.line > * {
  height: 62%;
}
.eyebrow-line {
  height: var(--text-eyebrow--line-height);
}
.subhead {
  height: var(--text-subhead--line-height);
}
.callout {
  height: calc(var(--text-callout--line-height) + 2 * var(--spacing-xxs));
}
.caption {
  height: var(--text-caption--line-height);
}
.body {
  height: var(--text-body--line-height);
}
</style>
