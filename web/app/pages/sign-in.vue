<script setup lang="ts">
import { useSessionStore } from '~/stores/session'

// The whole entry: an address, nothing else. Whether it leads to a code or to
// the invite step is the backend's answer, not a choice the member has to make.
const { t } = useI18n()
const session = useSessionStore()
const email = ref('')

onMounted(() => session.clearError())

// "Your account was deleted" (#101): said once, until she asks for a code.
const deleted = computed(() => session.accountDeleted)

// A build without a usable Supabase config has nothing to sign in to, so the
// screen says what is missing instead of offering a form that cannot work.
const config = parseAppConfig(useRuntimeConfig().public)
const configProblem = computed(() => {
  if (config.ok) return null
  return config.problem.kind === 'missing'
    ? t('signIn.configMissing', { key: config.problem.key })
    : t('signIn.configInvalidUrl', { value: config.problem.value })
})

async function submit() {
  session.clearAccountDeleted()
  const next = await session.submitEmail(email.value)
  if (next === 'verify') await navigateTo('/verify')
  if (next === 'signUp') await navigateTo('/sign-up')
}
</script>

<template>
  <AuthFrame screen="signIn">
    <h1 class="eyebrow" data-testid="signIn.title">{{ t('signIn.title') }}</h1>

    <p v-if="deleted" class="rounded-md bg-fill p-md text-center text-caption text-ink-muted" role="status" data-testid="signIn.deleted">
      {{ t('signIn.accountDeleted') }}
    </p>

    <p
      v-if="configProblem"
      class="rounded-md bg-error-soft p-md text-caption text-error"
      data-testid="signIn.configProblem"
    >
      {{ configProblem }}
    </p>

    <form v-else class="flex flex-col gap-md" @submit.prevent="submit">
      <UiField
        id="sign-in-email"
        v-model="email"
        :label="t('signIn.emailLabel')"
        :error="session.error ? t(`auth.error.${session.error}`) : null"
        error-testid="signIn.error"
        type="email"
        inputmode="email"
        autocomplete="email"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="go"
        required
        :placeholder="t('signIn.emailPlaceholder')"
        data-testid="signIn.email"
      />

      <UiButton type="submit" block :disabled="session.busy" data-testid="signIn.submit">
        {{ t('signIn.submit') }}
      </UiButton>

      <p class="text-center text-caption text-balance text-ink-faint">
        <UiIcon name="mail" :size="16" class="mr-xs inline-block align-text-bottom" />
        {{ t('signIn.intro') }}
      </p>
    </form>

    <template #footer>
      {{ t('signIn.noAccount') }}
      <NuxtLink
        to="/sign-up"
        class="text-ink underline decoration-ink-ghost underline-offset-4"
        data-testid="signIn.signUp"
      >
        {{ t('signIn.signUpLink') }}
      </NuxtLink>
    </template>
  </AuthFrame>
</template>
