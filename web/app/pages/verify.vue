<script setup lang="ts">
import { useSessionStore } from '~/stores/session'

const { t } = useI18n()
const session = useSessionStore()

const code = ref('')
const input = useTemplateRef<{ focus: () => void }>('codeInput')

const RESEND_AFTER_MS = 60_000
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined

const secondsUntilResend = computed(() => {
  const sentAt = session.pending?.sentAt ?? 0
  return Math.max(0, Math.ceil((sentAt + RESEND_AFTER_MS - now.value) / 1000))
})

onMounted(() => {
  session.clearError()
  ticker = setInterval(() => (now.value = Date.now()), 1_000)
  input.value?.focus()
})

onUnmounted(() => clearInterval(ticker))

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
        :invalid="Boolean(session.error)"
        data-testid="verify.code"
      />

      <p v-if="session.error" class="text-footnote text-error" data-testid="verify.error">
        {{ t(`auth.error.${session.error}`) }}
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
