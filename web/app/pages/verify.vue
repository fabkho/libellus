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
  <main
    class="screen-inset mx-auto flex min-h-dvh w-full max-w-(--size-max-content) flex-col justify-center gap-xl"
  >
    <header class="flex flex-col gap-sm">
      <p class="text-label font-semibold text-ink-muted">{{ t('app.name') }}</p>
      <h1 class="text-title font-semibold text-ink" data-testid="verify.title">
        {{ t('verify.title') }}
      </h1>
      <p class="text-body text-ink-muted" data-testid="verify.sentTo">
        {{ t('verify.sentTo', { email: session.pending?.email ?? '' }) }}
      </p>
    </header>

    <form class="flex flex-col gap-sm" @submit.prevent="submit">
      <label for="verify-code" class="text-label font-medium text-ink">
        {{ t('verify.codeLabel') }}
      </label>

      <CodeInput
        id="verify-code"
        ref="codeInput"
        v-model="code"
        :invalid="Boolean(session.error)"
        data-testid="verify.code"
      />

      <p v-if="session.error" class="text-caption text-error" data-testid="verify.error">
        {{ t(`auth.error.${session.error}`) }}
      </p>
    </form>

    <div class="flex flex-col items-center gap-xs">
      <button
        type="button"
        :disabled="secondsUntilResend > 0 || session.busy"
        class="min-h-(--size-touch) px-md text-label font-medium text-ink underline disabled:text-ink-faint disabled:no-underline"
        data-testid="verify.resend"
        @click="resend"
      >
        {{
          secondsUntilResend > 0
            ? t('verify.resendIn', { seconds: secondsUntilResend })
            : t('verify.resend')
        }}
      </button>

      <button
        type="button"
        class="min-h-(--size-touch) px-md text-label font-medium text-ink-muted underline"
        data-testid="verify.changeEmail"
        @click="changeEmail"
      >
        {{ t('verify.changeEmail') }}
      </button>
    </div>
  </main>
</template>
