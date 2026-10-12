<script setup lang="ts">
import { useSessionStore } from '~/stores/session'
import { secondsLeft } from '~/utils/codeCooldown'

const { t } = useI18n()
const session = useSessionStore()

const code = ref('')
const input = useTemplateRef<{ focus: () => void }>('codeInput')

// One mail per address per 20 s (utils/codeCooldown.ts): the button counts the window down from the last send.
const now = useClock()
const secondsUntilResend = computed(() => secondsLeft(session.pending?.sentAt ?? 0, now.value))

onMounted(() => {
  // "A code was sent a moment ago" (a second ask refused, stores/session.ts) is what she arrives with: it stays.
  if (session.error !== 'code_just_sent') session.clearError()
  input.value?.focus()
})

// Said while the window is open; once she may ask again it has done its job.
const failure = computed(() => {
  if (!session.error) return null
  if (session.error === 'code_just_sent') return secondsUntilResend.value > 0 ? t('auth.error.code_just_sent', { seconds: secondsUntilResend.value }) : null
  return t(`auth.error.${session.error}`)
})

// Typing the sixth digit is the submit: nobody wants to reach for a button with
// the code still in their head.
watch(code, async (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 6)
  if (digits !== value) {
    code.value = digits
    return
  }
  if (digits.length === 6) await submit()
})

async function submit() {
  if (session.busy) return
  const signedIn = await session.verify(code.value)
  if (signedIn) {
    await navigateTo('/')
    return
  }
  // A wrong code is retyped from the mail, not corrected digit by digit.
  code.value = ''
  input.value?.focus()
}

async function resend() {
  await session.resend()
  code.value = ''
  input.value?.focus()
}

async function changeEmail() {
  session.changeEmail()
  await navigateTo('/sign-in')
}
</script>

<template>
  <AuthFrame screen="verify">
    <div class="flex flex-col gap-sm">
      <h1 class="eyebrow" data-testid="verify.title">{{ t('verify.title') }}</h1>
      <p class="text-subhead text-ink-muted" data-testid="verify.sentTo">
        {{ t('verify.sentTo', { email: session.pending?.email ?? '' }) }}
      </p>
    </div>

    <form class="flex flex-col gap-sm" @submit.prevent="submit">
      <label for="verify-code" class="text-footnote text-ink-faint">{{ t('verify.codeLabel') }}</label>

      <CodeInput
        id="verify-code"
        ref="codeInput"
        v-model="code"
        :invalid="Boolean(session.error) && session.error !== 'code_just_sent'"
        data-testid="verify.code"
      />

      <p v-if="failure" class="text-footnote text-error" data-testid="verify.error">
        {{ failure }}
      </p>
    </form>

    <div class="flex flex-col items-center gap-xs">
      <UiButton
        tone="quiet"
        size="md"
        :disabled="secondsUntilResend > 0 || session.busy"
        data-testid="verify.resend"
        @click="resend"
      >
        <span class="tabular-nums">
          {{
            secondsUntilResend > 0
              ? t('verify.resendIn', { seconds: secondsUntilResend })
              : t('verify.resend')
          }}
        </span>
      </UiButton>
    </div>

    <template #footer>
      <button
        type="button"
        class="min-h-(--size-touch) px-md text-ink underline decoration-ink-ghost underline-offset-4"
        data-testid="verify.changeEmail"
        @click="changeEmail"
      >
        {{ t('verify.changeEmail') }}
      </button>
    </template>
  </AuthFrame>
</template>
