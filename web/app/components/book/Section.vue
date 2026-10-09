<script setup lang="ts">
// The shell of a section below the fold of the Book page ("More from the
// author", "Similar books" next): the pattern every one of them follows.
//
// - It costs nothing until it is near. ONE IntersectionObserver on the root
//   (a bare anchor, no height of its own) says once that the section is within
//   `rootMargin` of the viewport (`v-model:near` turns true, then the observer
//   is gone). The section starts its data then, never on page load: a Book page
//   that is only glanced at asks for nothing below its About. Without the API
//   the section is near at once.
// - Nothing is reserved while it loads, and no placeholders: it sits at the
//   page's foot, so nothing moves under a finger. When there is something to
//   show (`show`), the whole section (eyebrow heading and content) opens with
//   UiReveal over `standard`, everything under it gliding down; with nothing
//   (no data, offline, an error) it is not in the page at all, never an empty
//   heading, never an error state. Reduce Motion: UiReveal's short fade.
// - The heading is an `h2.eyebrow`, the section a labelled region. The content
//   is the slot; its px comes from the section (`px-ml`, as About).
//
//   <BookSection v-model:near="near" :show="Boolean(content)" :title="t('book.x')" testid="book.x">…</BookSection>
//
// The page watches `near` (and what it depends on, like the first linked
// author) and asks for its data. Several sections: each its own observer.
defineProps<{
  /** Whether there is something to show: opens the section, closes it again when it goes. */
  show: boolean
  /** The eyebrow heading. */
  title: string
  /** The region's test id; its heading is `<testid>Title`. */
  testid: string
}>()
const near = defineModel<boolean>('near', { default: false })

/** How far ahead of the viewport a section starts: about a screen of scrolling. */
const MARGIN = '600px 0px'

const root = useTemplateRef<HTMLElement>('root')
const headingId = useId()

onMounted(() => {
  if (near.value) return
  if (typeof IntersectionObserver === 'undefined' || !root.value) {
    near.value = true
    return
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      near.value = true
      observer.disconnect()
    },
    { rootMargin: MARGIN },
  )
  observer.observe(root.value)
  onBeforeUnmount(() => observer.disconnect())
})
</script>

<template>
  <div ref="root" class="relative">
    <UiReveal :show="show">
      <section class="px-ml pt-xl" :aria-labelledby="headingId" :data-testid="testid">
        <h2 :id="headingId" class="eyebrow mb-ms" :data-testid="`${testid}Title`">{{ title }}</h2>
        <slot />
      </section>
    </UiReveal>
  </div>
</template>
