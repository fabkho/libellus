<script setup lang="ts">
// Profile → Share (issue #171): one row, her reading page, On or Off, which
// opens its sheet (SharingSheet: the switch, the link, the sections). Read
// when the Profile opens.
import { useSharingStore } from '~/stores/sharing'

const { t } = useI18n()
const sharing = useSharingStore()
const open = ref(false)
onMounted(() => void sharing.load())
</script>

<template>
  <section id="share" class="flex flex-col gap-sm" data-testid="profile.share">
    <h2 class="eyebrow">{{ t('sharing.title') }}</h2>
    <UiRowGroup>
      <UiRow as="button" icon="share" :label="t('sharing.row')" chevron data-testid="profile.readingPage" @click="open = true">
        <span v-if="sharing.settings" :class="sharing.settings.token ? 'text-ink-muted' : 'text-ink-faint'" data-testid="profile.readingPageValue">
          {{ sharing.settings.token ? t('sharing.rowOn') : t('sharing.rowOff') }}
        </span>
      </UiRow>
    </UiRowGroup>
    <SharingSheet v-model:open="open" />
  </section>
</template>
