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

const { t, te } = useI18n()

const initials = computed(() => (props.author ? authorInitials(props.author.name) : ''))
const span = computed(() => (props.author ? lifeSpan(props.author.born, props.author.died) : null))
const dates = computed(() => {
  const s = span.value
  if (!s) return null
  if (s.kind === 'span') return t('author.lived', { born: s.born, died: s.died })
  if (s.kind === 'born') return t('author.born', { year: s.born })
  return t('author.died', { year: s.died })
})
const genreLabel = (id: string) => (te(`genre.${id}`) ? t(`genre.${id}`) : genreFallback(id))

const photoShown = ref(false)
watch(
  () => props.author?.photo?.url,
  () => (photoShown.value = false),
)
const credit = computed(() => props.author?.photo?.credit ?? null)

const summary = computed(() => props.author?.summary ?? null)
const long = computed(() => (summary.value?.text.length ?? 0) > 360)
const expanded = ref(false)
</script>

<template>
  <section class="relative flex flex-col items-center px-xl pt-sm text-center" data-testid="author.hero">
    <template v-if="author">
      <span class="ring figures relative flex items-center justify-center overflow-hidden rounded-pill bg-surface-raised text-title text-ink-muted shadow-cover" aria-hidden="true">
        <span data-testid="author.initials">{{ initials }}</span>
        <img
          v-if="author.photo?.url"
          :src="author.photo.url"
          alt=""
          draggable="false"
          decoding="async"
          class="photo absolute inset-0 size-full object-cover"
          :class="photoShown && 'shown'"
          data-testid="author.photo"
          @load="photoShown = true"
        />
        <span class="pointer-events-none absolute inset-0 rounded-pill edge" />
      </span>
      <h1 class="mt-md max-w-full text-title text-balance wrap-anywhere" :class="{ arrive: arriving }" data-testid="author.name">{{ author.name }}</h1>
      <p v-if="dates" class="eyebrow mt-xs" :class="{ arrive: arriving }" data-testid="author.dates">{{ dates }}</p>
      <ul v-if="genres.length" class="mt-ms flex flex-wrap justify-center gap-xs" :aria-label="t('author.genres')" :class="{ arrive: arriving }" data-testid="author.genres">
        <li v-for="genre in genres" :key="genre" class="inline-flex h-(--size-button-sm) items-center rounded-pill bg-fill px-ms text-caption text-ink-muted edge" data-testid="author.genre">
          {{ genreLabel(genre) }}
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
      <p v-if="summary || credit" class="mt-sm w-full text-left text-footnote text-ink-faint" data-testid="author.credits">
        <a v-if="summary" :href="summary.url" target="_blank" rel="noopener" class="credit underline-offset-2 hover:underline" data-testid="author.wikipedia">{{ t('author.fromWikipedia') }}</a>
        <span v-if="summary && credit" aria-hidden="true">{{ ' · ' }}</span>
        <span v-if="credit" data-testid="author.photoCredit">
          <a v-if="credit.fileUrl" :href="credit.fileUrl" target="_blank" rel="noopener" class="credit underline-offset-2 hover:underline" data-testid="author.photoFile">{{ credit.artist ? t('author.photoBy', { artist: credit.artist }) : t('author.photo') }}</a>
          <template v-else>{{ credit.artist ? t('author.photoBy', { artist: credit.artist }) : t('author.photo') }}</template>
          <template v-if="credit.licence">
            {{ ' · ' }}<a v-if="credit.licenceUrl" :href="credit.licenceUrl" target="_blank" rel="noopener license" class="credit underline-offset-2 hover:underline" data-testid="author.photoLicence">{{ credit.licence }}</a><template v-else>{{ credit.licence }}</template>
          </template>
        </span>
      </p>
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

.clamped {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
}

/* Links in a line of small text: padded above and below for the finger (inline padding moves no line). */
.credit {
  padding-block: var(--spacing-sm);
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
