<script setup lang="ts">
// One paragraph or list item of a legal text: its bold, its links and its placeholders (utils/legalInline.ts).
// An address inside the app keeps the text's language (`?lang=`), so Privacy → Imprint stays in German.
import type { LegalLang } from '~/legal/types'
import { isAppPath, parseInline } from '~/utils/legalInline'

const props = defineProps<{ source: string; lang: LegalLang }>()
const parts = computed(() => parseInline(props.source))
const LINK = 'text-accent-ink underline underline-offset-4'
</script>

<template>
  <template v-for="(part, i) in parts" :key="i">
    <b v-if="part.kind === 'bold'" class="font-medium text-ink">{{ part.text }}</b>
    <mark v-else-if="part.kind === 'placeholder'" class="placeholder wrap-anywhere rounded-sm bg-accent-soft px-xs text-accent-ink">{{ part.text }}</mark>
    <NuxtLink v-else-if="part.kind === 'link' && isAppPath(part.href)" :to="{ path: part.href, query: { lang } }" :class="LINK" data-testid="legal.link">{{ part.text }}</NuxtLink>
    <a v-else-if="part.kind === 'link'" :href="part.href" :class="LINK" :target="part.href.startsWith('https:') ? '_blank' : undefined" rel="noopener noreferrer" data-testid="legal.link">{{ part.text }}</a>
    <template v-else>{{ part.text }}</template>
  </template>
</template>
