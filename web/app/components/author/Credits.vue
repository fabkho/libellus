<script setup lang="ts">
// The credits the licences ask for (#167), wherever an author's Wikipedia intro
// or portrait shows: "From Wikipedia" (CC BY-SA) linking the article, and the
// portrait's author and licence linking the file. Nothing when there is
// neither. `testid` is the prefix of its ids (`<testid>.credits`, …).
import type { AuthorHero } from '~/data/enrich'

const props = withDefaults(defineProps<{ author: Pick<AuthorHero, 'summary' | 'photo'>; testid?: string }>(), { testid: 'author' })

const { t } = useI18n()
const summary = computed(() => props.author.summary ?? null)
const credit = computed(() => props.author.photo?.credit ?? null)
</script>

<template>
  <p v-if="summary || credit" class="text-left text-footnote text-ink-faint" :data-testid="`${testid}.credits`">
    <a v-if="summary" :href="summary.url" target="_blank" rel="noopener" class="credit underline-offset-2 hover:underline" :data-testid="`${testid}.wikipedia`">{{ t('author.fromWikipedia') }}</a>
    <span v-if="summary && credit" aria-hidden="true">{{ ' · ' }}</span>
    <span v-if="credit" :data-testid="`${testid}.photoCredit`">
      <a v-if="credit.fileUrl" :href="credit.fileUrl" target="_blank" rel="noopener" class="credit underline-offset-2 hover:underline" :data-testid="`${testid}.photoFile`">{{ credit.artist ? t('author.photoBy', { artist: credit.artist }) : t('author.photo') }}</a>
      <template v-else>{{ credit.artist ? t('author.photoBy', { artist: credit.artist }) : t('author.photo') }}</template>
      <template v-if="credit.licence">
        {{ ' · ' }}<a v-if="credit.licenceUrl" :href="credit.licenceUrl" target="_blank" rel="noopener license" class="credit underline-offset-2 hover:underline" :data-testid="`${testid}.photoLicence`">{{ credit.licence }}</a><template v-else>{{ credit.licence }}</template>
      </template>
    </span>
  </p>
</template>

<style scoped>
/* Links in a line of small text: padded above and below for the finger (inline padding moves no line). */
.credit {
  padding-block: var(--spacing-sm);
}
</style>
