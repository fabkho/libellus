<script setup lang="ts">
// Book links (issue #116) on the Book page's metadata block (components/book/Meta.vue), as quiet as that block's
// values: the instance's links first, then the member's own, each list in its order (stores/linkTemplates.ts),
// filled from this Book; one it cannot fill (no ISBN) is left out. They all show at once, left-aligned with the
// block and wrapping onto as many rows as they need, with dots between them — no first-one-plus-More any more
// (docs/plans/book-hero-metadata.md: the mock shows five links wrapping, no button). They open in a new tab.
// Nothing is looked up: they are just links. Hidden when there are none.
import type { Book, BookSnapshot } from '~/data/books'
import { useLinkTemplatesStore } from '~/stores/linkTemplates'

const props = defineProps<{ book: Book | BookSnapshot }>()

const { t } = useI18n()
const templates = useLinkTemplatesStore()

// After the page has rendered, so the block never holds the page up; the device's copy shows at once.
onMounted(() => void templates.load())

const links = computed(() => templates.linksFor(props.book))
</script>

<template>
  <nav v-if="links.length" :aria-label="t('book.links.label')" data-testid="book.links">
    <ul class="flex flex-wrap items-center gap-x-sm gap-y-xs text-meta text-ink-faint">
      <li v-for="(link, i) in links" :key="`${i}-${link.href}`" class="flex items-center gap-x-sm">
        <span v-if="i > 0" class="dot text-ink-ghost" aria-hidden="true" />
        <a :href="link.href" target="_blank" rel="noopener noreferrer" class="link text-ink-muted" data-testid="book.link">{{ link.label }}</a>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}

.link {
  position: relative;
  text-decoration: underline;
  text-decoration-color: var(--color-hairline-strong);
  text-underline-offset: var(--spacing-xxs);
}

/* The touch target is the size of a fingertip, not of the 11px word. */
.link::after {
  content: '';
  position: absolute;
  inset: 50% calc(-1 * var(--spacing-sm)) auto;
  height: var(--size-touch);
  transform: translateY(-50%);
}
</style>
