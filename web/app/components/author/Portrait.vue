<script setup lang="ts">
// An author's portrait in its ring (#167): her initials underneath, so the
// circle never empties while the photo decodes (initials alone where no source
// has a portrait), the photo fading in over them once decoded. The author
// page's hero and the Book page's "More from the author" both use it, the ring
// at the same size. Decorative: the name is always beside it. `testid` is the
// prefix of its ids (`<testid>.initials`, `<testid>.photo`).
import type { AuthorHero } from '~/data/enrich'

const props = withDefaults(defineProps<{ author: Pick<AuthorHero, 'name' | 'photo'>; testid?: string }>(), { testid: 'author' })

const initials = computed(() => authorInitials(props.author.name))
const photoShown = ref(false)
watch(
  () => props.author.photo?.url,
  () => (photoShown.value = false),
)
</script>

<template>
  <span class="ring figures relative flex shrink-0 items-center justify-center overflow-hidden rounded-pill bg-surface-raised text-title text-ink-muted shadow-cover" aria-hidden="true">
    <span :data-testid="`${testid}.initials`">{{ initials }}</span>
    <img
      v-if="author.photo?.url"
      :src="author.photo.url"
      alt=""
      draggable="false"
      decoding="async"
      class="photo absolute inset-0 size-full object-cover"
      :class="photoShown && 'shown'"
      :data-testid="`${testid}.photo`"
      @load="photoShown = true"
    />
    <span class="pointer-events-none absolute inset-0 rounded-pill edge" />
  </span>
</template>

<style scoped>
.ring {
  width: var(--size-cover-md);
  height: var(--size-cover-md);
}

/* The portrait fades in over the initials once decoded. */
.photo {
  opacity: 0;
  transition: opacity var(--duration-standard) var(--ease-standard);
}
.photo.shown {
  opacity: 1;
}
</style>
