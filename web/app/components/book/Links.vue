<script setup lang="ts">
// Book links (issue #116) under the book page's facts and Goodreads line, as quiet as that line:
// the first link by its label, then More when there are others, which opens the rest in place
// (Less folds them again). The instance's links first, then the member's own, each list in its
// order (stores/linkTemplates.ts), filled from this Book; one it cannot fill (no ISBN) is left
// out. They open in a new tab. Nothing is looked up: they are just links. Hidden when there are none.
import type { Book, BookSnapshot } from '~/data/books'
import { useLinkTemplatesStore } from '~/stores/linkTemplates'

const props = defineProps<{ book: Book | BookSnapshot }>()

const { t } = useI18n()
const templates = useLinkTemplatesStore()

// After the page has rendered, so the row never holds the page up; the device's copy shows at once.
onMounted(() => void templates.load())

const links = computed(() => templates.linksFor(props.book))
const open = ref(false)
// Another Book (the same page, a Change edition): folded again.
watch(
  () => `${props.book.isbn13 ?? ''}|${props.book.title}`,
  () => (open.value = false),
)
const shown = computed(() => (open.value ? links.value : links.value.slice(0, 1)))
const restId = useId()
</script>

<template>
  <nav v-if="links.length" class="pt-ms" :aria-label="t('book.links.label')" data-testid="book.links">
    <ul :id="restId" class="flex flex-wrap items-center justify-center gap-x-sm gap-y-xs text-meta text-ink-faint">
      <li v-for="(link, i) in shown" :key="`${i}-${link.href}`" class="flex items-center gap-x-sm">
        <span v-if="i > 0" class="dot text-ink-ghost" aria-hidden="true" />
        <a :href="link.href" target="_blank" rel="noopener noreferrer" class="link text-ink-muted" data-testid="book.link">{{ link.label }}</a>
      </li>
      <li v-if="links.length > 1" class="flex items-center gap-x-sm">
        <span class="dot text-ink-ghost" aria-hidden="true" />
        <button
          type="button"
          class="link text-ink-faint"
          :aria-expanded="open"
          :aria-controls="restId"
          :aria-label="open ? undefined : t('book.links.moreLabel')"
          data-testid="book.linksMore"
          @click="open = !open"
        >
          {{ open ? t('book.links.less') : t('book.links.more') }}
        </button>
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
