<script setup lang="ts">
import { LEGAL_DOCUMENTS, legalLangOf, placeholdersOf } from '~/legal'
import { IMPRINT_ENABLED } from '~/legal/config'
import { LEGAL_LANGS, type LegalLang, type LegalPage } from '~/legal/types'
import { useSessionStore } from '~/stores/session'

// The privacy notice and the imprint (docs/legal-checklist.md): a pushed screen like the other pages
// off the tab bar (UiTopBar with Back), the text in English and in German on the same page with a
// small switch. Open to everyone, signed in or not (utils/publicPath.ts), and part of the precached
// app, so it opens offline too. The language is `?lang=` when the address names one (a link from the
// other page, or one you send), else the app's language (German or English, utils/locale.ts): the text is chosen before the first paint, so
// nothing moves. A draft banner shows while a placeholder is still in the text.
const props = defineProps<{ page: LegalPage }>()
const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()
const session = useSessionStore()

const lang = ref<LegalLang>(legalLangOf(route.query.lang, [locale.value]))
const text = computed(() => LEGAL_DOCUMENTS[props.page][lang.value])
const draft = computed(() => placeholdersOf(LEGAL_DOCUMENTS[props.page]).length > 0)
const DRAFT: Record<LegalLang, string> = {
  en: 'Draft: this text has not been reviewed yet, and what is marked like this is still missing.',
  de: 'Entwurf: Dieser Text ist noch nicht geprüft, und was so markiert ist, fehlt noch.',
}
const options = LEGAL_LANGS.map((value) => ({ value, label: value === 'en' ? 'English' : 'Deutsch' }))

useHead(() => ({ title: text.value.title }))

// The address follows the switch, so a copied link opens in the language on screen. Not through the router:
// a query-only navigation would scroll the page.
watch(lang, (next) => {
  const url = new URL(window.location.href)
  url.searchParams.set('lang', next)
  window.history.replaceState(window.history.state, '', url)
})

function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo(session.status === 'signedIn' ? '/profile' : '/sign-in', { replace: true })
}
</script>

<template>
  <main class="legal min-h-dvh pb-xxl" :data-page="page" data-testid="legal.screen">
    <UiTopBar class="legal-chrome" :back-label="t('legal.back')" back-testid="legal.back" @back="back" />
    <div class="mx-auto flex max-w-(--size-max-content) flex-col gap-lg px-screen pt-bar">
      <header class="flex flex-col gap-ms">
        <h1 :lang="lang" class="text-large-title" data-testid="legal.title">{{ text.title }}</h1>
        <div class="legal-chrome flex">
          <UiSegmented v-model="lang" compact :options="options" :label="t('legal.language')" testid="legal.lang" />
        </div>
        <p v-if="draft" :lang="lang" class="rounded-md bg-fill px-inset py-ms text-caption text-ink-muted" data-testid="legal.draft">{{ DRAFT[lang] }}</p>
      </header>
      <LegalDocument :text="text" :lang="lang" />
      <!-- The other page, once there is one. -->
      <LegalLinks v-if="IMPRINT_ENABLED" class="legal-chrome" />
    </div>
  </main>
</template>

<style>
/* Printed: ink on paper whatever the theme, the bar, the switch and the links left out. */
@media print {
  .legal-chrome {
    display: none !important;
  }
  .legal,
  .legal * {
    color: CanvasText !important;
    background: transparent !important;
  }
  .legal .placeholder {
    text-decoration: underline;
  }
}
</style>
