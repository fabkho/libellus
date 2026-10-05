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
  <AuthFrame screen="signUp">
    <h1 class="eyebrow" data-testid="signUp.title">{{ t('signUp.title') }}</h1>

    <form class="flex flex-col gap-md" @submit.prevent="submit">
      <UiField
        id="sign-up-email"
        v-model="email"
        :label="t('signUp.emailLabel')"
        :error="emailError ? t(`auth.error.${emailError}`) : null"
        error-testid="signUp.emailError"
        type="email"
        inputmode="email"
        autocomplete="email"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        required
        :placeholder="t('signUp.emailPlaceholder')"
        data-testid="signUp.email"
      />

      <UiField
        id="sign-up-invite"
        v-model="inviteCode"
        :label="t('signUp.inviteLabel')"
        :error="inviteError ? t(`auth.error.${inviteError}`) : null"
        error-testid="signUp.inviteError"
        type="text"
        autocomplete="off"
        autocapitalize="characters"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="go"
        :placeholder="t('signUp.invitePlaceholder')"
        data-testid="signUp.inviteCode"
      />

      <UiButton type="submit" block :disabled="session.busy" data-testid="signUp.submit">
        {{ t('signUp.submit') }}
      </UiButton>

      <p class="text-center text-caption text-balance text-ink-faint">
        <UiIcon name="lock" :size="16" class="mr-xs inline-block align-text-bottom" />
        {{ t('signUp.intro') }}
      </p>
    </form>

    <template #footer>
      {{ t('signUp.hasAccount') }}
      <NuxtLink
        to="/sign-in"
        class="text-ink underline decoration-ink-ghost underline-offset-4"
        data-testid="signUp.signIn"
      >
        {{ t('signUp.signInLink') }}
      </NuxtLink>
    </template>
  </AuthFrame>
</template>
