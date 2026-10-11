<script setup lang="ts">
// The top of an author page (#167): the portrait in a ring (her initials
// underneath, so the circle never empties while the photo decodes; initials
// alone where no source has a portrait), the name, the life dates in mono, the
// genres her works are in (display only), and the Wikipedia intro, cut at five
// lines with More. The credits the licences ask for sit under them: "From
// Wikipedia" linking the article, and the portrait's author and licence
// linking the file. With `loading` it is the same shape in placeholders.
import type { AuthorHero } from '~/data/enrich'
import type { GenreId } from '~/data/enrich'

const props = defineProps<{ author: AuthorHero | null; genres: readonly GenreId[]; arriving?: boolean }>()

const { t } = useI18n()

const dates = useLifeDates(() => props.author)

const summary = computed(() => props.author?.summary ?? null)
const long = computed(() => (summary.value?.text.length ?? 0) > 360)
const expanded = ref(false)
</script>

<template>
  <section class="relative flex flex-col items-center px-xl pt-sm text-center" data-testid="author.hero">
    <template v-if="author">
      <AuthorPortrait :author="author" />
      <h1 class="mt-md max-w-full text-title text-balance wrap-anywhere" :class="{ arrive: arriving }" data-testid="author.name">{{ author.name }}</h1>
      <p v-if="dates" class="eyebrow mt-xs" :class="{ arrive: arriving }" data-testid="author.dates">{{ dates }}</p>
      <ul v-if="genres.length" class="mt-ms flex flex-wrap justify-center gap-xs" :aria-label="t('author.genres')" :class="{ arrive: arriving }" data-testid="author.genres">
        <li v-for="genre in genres" :key="genre" class="inline-flex h-(--size-button-sm) items-center rounded-pill bg-fill px-ms text-caption text-ink-muted edge" data-testid="author.genre">
          {{ t(`genre.${genre}`) }}
        </li>
      </ul>
      <div v-if="summary" class="mt-ml w-full text-left" :class="{ arrive: arriving }">
        <p class="text-subhead text-ink-muted" :class="long && !expanded && 'clamped'" :lang="summary.language" data-testid="author.summary">{{ summary.text }}</p>
        <button
          v-if="long && !expanded"
          type="button"
          class="-ml-sm min-h-(--size-touch) px-sm text-subhead font-medium text-ink"
          data-testid="author.more"
          @click="expanded = true"
        >
          {{ t('author.more') }}
        </button>
      </div>
      <AuthorCredits :author="author" class="mt-sm w-full" />
    </template>

    <!-- Loading: the same shape in placeholders, replaced whole when the page comes (nothing below moves). -->
    <template v-else>
      <span class="ring skeleton wave rounded-pill" aria-hidden="true" />
      <span class="line title-line mt-md w-1/2" aria-hidden="true"><span class="skeleton wave w-full" :style="{ '--wave': 0.1 }" /></span>
      <span class="line eyebrow-line mt-xs w-1/4" aria-hidden="true"><span class="skeleton wave w-full" :style="{ '--wave': 0.2 }" /></span>
      <span class="mt-ml flex w-full flex-col" aria-hidden="true">
        <span v-for="i in 4" :key="i" class="line body-line" :class="i === 4 ? 'w-2/3' : 'w-full'"><span class="skeleton wave w-full" :style="{ '--wave': 0.2 + i * 0.1 }" /></span>
      </span>
    </template>
  </section>
</template>

<style scoped>
.clamped {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
}

/* A placeholder line at the height of the text it stands for. */
.line {
  display: flex;
  align-items: center;
}
.line > * {
  height: 62%;
}
.title-line {
  height: var(--text-title--line-height);
}
.eyebrow-line {
  height: var(--text-eyebrow--line-height);
}
.body-line {
  height: var(--text-subhead--line-height);
}
</style>
