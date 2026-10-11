<script setup lang="ts">
// "Privacy · Imprint": the quiet line under the sign-in and sign-up forms and at the bottom of the
// Profile. Plain links, 44 px high each; the pages themselves are open to everyone (utils/publicPath.ts).
// The imprint is postponed (legal/config.ts): until then the line is the privacy link alone.
import { IMPRINT_ENABLED } from '~/legal/config'

const { t } = useI18n()
const LINK = 'inline-flex min-h-(--size-touch) items-center px-sm underline decoration-ink-ghost underline-offset-4 hover:text-ink-muted'
</script>

<template>
  <nav :aria-label="t('legal.nav')" class="flex items-center justify-center text-caption text-ink-faint" data-testid="legal.links">
    <NuxtLink to="/privacy" :class="LINK" data-testid="legal.privacy">{{ t('legal.privacy') }}</NuxtLink>
    <template v-if="IMPRINT_ENABLED">
      <span aria-hidden="true">·</span>
      <NuxtLink to="/imprint" :class="LINK" data-testid="legal.imprint">{{ t('legal.imprint') }}</NuxtLink>
    </template>
  </nav>
</template>
