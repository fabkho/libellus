<script setup lang="ts">
import { useSessionStore } from '~/stores/session'

// Libellus is invite-only: an address and the invite code that lets it in. The
// database judges the code (and again when the address is proved); the form
// asks first so a wrong code fails against the field that caused it.
const { t } = useI18n()
const session = useSessionStore()

// Arrives prefilled when the sign-in screen found no account for the address.
const email = ref(session.signUpEmail)
const inviteCode = ref('')

onMounted(() => session.clearError())

const INVITE_ERRORS = ['invite_required', 'invite_invalid', 'invite_expired', 'invite_exhausted', 'invite_gone']
// An invite problem belongs under the invite field, everything else under the address.
const inviteError = computed(() =>
  session.error && INVITE_ERRORS.includes(session.error) ? session.error : null,
)
const emailError = computed(() => (session.error && !inviteError.value ? session.error : null))

async function submit() {
  const next = await session.submitSignUp({ email: email.value, inviteCode: inviteCode.value })
  if (next === 'verify') await navigateTo('/verify')
}
</script>

<template>
  <main
    class="screen-inset mx-auto flex min-h-dvh w-full max-w-(--size-max-content) flex-col justify-center gap-xl"
  >
    <header class="flex flex-col gap-sm">
      <p class="text-label font-semibold text-ink-muted">{{ t('app.name') }}</p>
      <h1 class="text-title font-semibold text-ink" data-testid="signUp.title">
        {{ t('signUp.title') }}
      </h1>
      <p class="text-body text-ink-muted">{{ t('signUp.intro') }}</p>
    </header>

    <form class="flex flex-col gap-md" @submit.prevent="submit">
      <div class="flex flex-col gap-xs">
        <label for="sign-up-email" class="text-label font-medium text-ink">
          {{ t('signUp.emailLabel') }}
        </label>
        <input
          id="sign-up-email"
          v-model="email"
          type="email"
          inputmode="email"
          autocomplete="email"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          required
          :placeholder="t('signUp.emailPlaceholder')"
          :aria-invalid="emailError ? true : undefined"
          class="min-h-(--size-touch) rounded-md border border-outline bg-surface-raised px-md text-body text-ink placeholder:text-ink-faint"
          data-testid="signUp.email"
        />
        <p v-if="emailError" class="text-caption text-error" data-testid="signUp.emailError">
          {{ t(`auth.error.${emailError}`) }}
        </p>
      </div>

      <div class="flex flex-col gap-xs">
        <label for="sign-up-invite" class="text-label font-medium text-ink">
          {{ t('signUp.inviteLabel') }}
        </label>
        <input
          id="sign-up-invite"
          v-model="inviteCode"
          type="text"
          autocomplete="off"
          autocapitalize="characters"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="go"
          :placeholder="t('signUp.invitePlaceholder')"
          :aria-invalid="inviteError ? true : undefined"
          class="min-h-(--size-touch) rounded-md border border-outline bg-surface-raised px-md text-body text-ink placeholder:text-ink-faint"
          data-testid="signUp.inviteCode"
        />
        <p v-if="inviteError" class="text-caption text-error" data-testid="signUp.inviteError">
          {{ t(`auth.error.${inviteError}`) }}
        </p>
      </div>

      <button
        type="submit"
        :disabled="session.busy"
        class="min-h-(--size-touch) rounded-md bg-accent px-md text-body font-medium text-on-accent disabled:opacity-60"
        data-testid="signUp.submit"
      >
        {{ t('signUp.submit') }}
      </button>

      <p class="text-center text-label text-ink-muted">
        {{ t('signUp.hasAccount') }}
        <NuxtLink to="/sign-in" class="font-medium text-ink underline" data-testid="signUp.signIn">
          {{ t('signUp.signInLink') }}
        </NuxtLink>
      </p>
    </form>
  </main>
</template>
