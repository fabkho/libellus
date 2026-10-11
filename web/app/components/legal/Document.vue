<script setup lang="ts">
// The body of a legal text: its lead and its sections (legal/types.ts). Plain headings, paragraphs and
// lists in the text tokens, one h2 a section; the `lang` attribute is the text's own, so a screen reader
// reads the German in German on a page whose chrome is English.
import type { LegalLang, LegalText } from '~/legal/types'

defineProps<{ text: LegalText; lang: LegalLang }>()
</script>

<template>
  <article :lang="lang" class="flex flex-col gap-xl text-subhead text-ink" data-testid="legal.text">
    <p class="text-body text-ink-muted"><LegalInline :source="text.lead" :lang="lang" /></p>
    <section v-for="section in text.sections" :key="section.id" :aria-labelledby="`legal-${section.id}`" class="flex flex-col gap-ms" :data-section="section.id">
      <h2 :id="`legal-${section.id}`" class="text-callout font-medium">{{ section.heading }}</h2>
      <template v-for="(block, i) in section.blocks" :key="i">
        <p v-if="'p' in block" class="text-pretty"><LegalInline :source="block.p" :lang="lang" /></p>
        <ul v-else-if="'ul' in block" class="flex list-disc flex-col gap-sm pl-ml marker:text-ink-faint">
          <li v-for="(item, j) in block.ul" :key="j" class="text-pretty"><LegalInline :source="item" :lang="lang" /></li>
        </ul>
        <p v-else class="flex flex-col">
          <span v-for="(line, j) in block.lines" :key="j"><LegalInline :source="line" :lang="lang" /></span>
        </p>
      </template>
    </section>
    <p class="figures text-meta text-ink-faint" data-testid="legal.version">{{ text.version }}</p>
  </article>
</template>
