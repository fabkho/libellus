<script setup lang="ts">
// The privacy policy (issue #90): Google Play asks for a public URL before the Android app
// (docs/ANDROID.md) can be listed, so this is the one screen anybody may open, signed in or
// not (middleware/auth.global.ts); sign-in, sign-up and the Profile's account rows link here.
// The owner's answers, in plain words: who is responsible, what is kept and why, where, who
// processes it, what the device asks directly, the member's rights, deletion, age. No tab bar
// (a signed-out visitor has no tabs). Kept in step with the Data safety answers in docs/ANDROID.md.
definePageMeta({ layout: false, screen: 'privacy' })

/** Where questions, requests and deletions go: the owner's address. Change it here only. */
const CONTACT = 'fabian@fabkho.dev'
/** The supervisory authority for the controller (North Rhine-Westphalia). */
const AUTHORITY_URL = 'https://www.ldi.nrw.de'

const { t } = useI18n()
const router = useRouter()

useHead({ title: () => `${t('privacy.title')} · ${t('app.name')}` })

function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo('/')
}

const SECTIONS = ['keeps', 'why', 'device', 'processors', 'direct', 'public', 'rights', 'delete', 'age'] as const
const LINK = 'text-ink underline decoration-ink-ghost underline-offset-4'
</script>

<template>
  <div class="relative min-h-dvh pb-xxl" data-testid="privacy">
    <UiTopBar :back-label="t('privacy.back')" back-testid="privacy.back" @back="back" />

    <header class="mx-auto flex w-full max-w-(--size-max-content) flex-col gap-xs px-screen pt-bar">
      <h1 class="text-large-title" data-testid="privacy.title">{{ t('privacy.title') }}</h1>
      <p class="text-subhead text-ink-muted" data-testid="privacy.updated">{{ t('privacy.updated') }}</p>
    </header>

    <article class="mx-auto flex w-full max-w-(--size-max-content) flex-col gap-xl px-screen pt-lg">
      <i18n-t keypath="privacy.intro" tag="p" class="text-body" scope="global" data-testid="privacy.intro">
        <template #email>
          <a :href="`mailto:${CONTACT}`" :class="LINK" data-testid="privacy.email">{{ CONTACT }}</a>
        </template>
      </i18n-t>
      <section v-for="key in SECTIONS" :key="key" class="flex flex-col gap-sm" :data-testid="`privacy.${key}`">
        <h2 class="eyebrow">{{ t(`privacy.${key}.title`) }}</h2>
        <i18n-t :keypath="`privacy.${key}.text`" tag="p" class="text-body text-ink-muted" scope="global">
          <template #email>
            <a :href="`mailto:${CONTACT}`" :class="LINK" data-testid="privacy.email">{{ CONTACT }}</a>
          </template>
          <template #authority>
            <a :href="AUTHORITY_URL" target="_blank" rel="noopener" :class="LINK" data-testid="privacy.authority">{{ t('privacy.authority') }}</a>
          </template>
        </i18n-t>
      </section>
    </article>
  </div>
</template>
