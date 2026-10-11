<script setup lang="ts">
// Language, a row of the Profile's Account (one line in Account.vue, under Dark mode): English or Deutsch,
// each named in its own language, as a small segmented choice in the row (the way Glass is). A tap switches the
// whole app at once, no reload, and is kept on this device (stores/locale.ts); until she taps, the app
// follows the phone's language (utils/locale.ts). The label is the language it is in, so a member who finds
// herself in the wrong one can still see which row it is by its globe and the two names.
import { useLocaleStore } from '~/stores/locale'
import { APP_LOCALES, type AppLocale } from '~/utils/locale'

const { t } = useI18n()
const store = useLocaleStore()
const model = computed<AppLocale>({
  get: () => store.current,
  set: (code) => void store.choose(code),
})
const options = APP_LOCALES.map(({ code, name }) => ({ value: code, label: name }))
</script>

<template>
  <UiRow icon="globe" :label="t('language.row')" data-testid="profile.language">
    <template #trailing>
      <UiSegmented v-model="model" compact :options="options" :label="t('language.label')" testid="profile.languageChoice" />
    </template>
  </UiRow>
</template>
