<script setup lang="ts">
import { useSessionStore } from '~/stores/session'

// The whole entry: an address, nothing else. Whether it leads to a code or to
// the invite step is the backend's answer, not a choice the member has to make.
const { t } = useI18n()
const session = useSessionStore()
const email = ref('')

onMounted(() => session.clearError())

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
  const next = await session.submitEmail(email.value)
  if (next === 'verify') await navigateTo('/verify')
  if (next === 'signUp') await navigateTo('/sign-up')
}
</script>

<template>
  <main
    class="screen-inset mx-auto flex min-h-dvh w-full max-w-(--size-max-content) flex-col justify-center gap-xl"
  >
    <header class="flex flex-col gap-sm">
      <p class="text-label font-semibold text-ink-muted" data-testid="signIn.brand">
        {{ t('app.name') }}
      </p>
      <h1 class="text-title font-semibold text-ink" data-testid="signIn.title">
        {{ t('signIn.title') }}
      </h1>
      <p class="text-body text-ink-muted">{{ t('signIn.intro') }}</p>
    </header>

    <p
      v-if="configProblem"
      class="rounded-md bg-error-soft p-md text-label text-error"
      data-testid="signIn.configProblem"
    >
      {{ configProblem }}
    </p>

    <form v-else class="flex flex-col gap-md" @submit.prevent="submit">
      <div class="flex flex-col gap-xs">
        <label for="sign-in-email" class="text-label font-medium text-ink">
          {{ t('signIn.emailLabel') }}
        </label>
        <input
          id="sign-in-email"
          v-model="email"
          type="email"
          inputmode="email"
          autocomplete="email"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="go"
          required
          :placeholder="t('signIn.emailPlaceholder')"
          :aria-invalid="session.error ? true : undefined"
          class="min-h-(--size-touch) rounded-md border border-outline bg-surface-raised px-md text-body text-ink placeholder:text-ink-faint"
          data-testid="signIn.email"
        />
        <p v-if="session.error" class="text-caption text-error" data-testid="signIn.error">
          {{ t(`auth.error.${session.error}`) }}
        </p>
      </div>

      <button
        type="submit"
        :disabled="session.busy"
        class="min-h-(--size-touch) rounded-md bg-accent px-md text-body font-medium text-on-accent disabled:opacity-60"
        data-testid="signIn.submit"
      >
        {{ t('signIn.submit') }}
      </button>

      <p class="text-center text-label text-ink-muted">
        {{ t('signIn.noAccount') }}
        <NuxtLink to="/sign-up" class="font-medium text-ink underline" data-testid="signIn.signUp">
          {{ t('signIn.signUpLink') }}
        </NuxtLink>
      </p>
    </form>
  </main>
</template>
