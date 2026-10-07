<script setup lang="ts">
// The waitlist form at the end of a reading page and a Book card (issue #171). Libellus is
// invite-only and the page creates no account: a visitor leaves her address and the owner invites
// her when there is room (no e-mail is sent from here; the owner reads the list in Profile → Account
// → Waitlist). One field and one button, then what the address is used for. The page's token goes
// along so the database can tell whose page it was (it keeps nothing of the token). `website` is a
// honeypot: a field no person sees (hidden from everyone, out of the tab order) that a bot fills.
// States: ready; sending; "You're on the list" (a polite status that replaces the form; the same answer
// whether she was new or already there); an address that is not one (under the field, nothing sent);
// too many tries (a limit, in words); couldn't be added (Try again keeps the address); offline (the
// button says Offline, #15).
import { looksLikeEmail } from '~/data/waitlist'
import { useWaitlistStore } from '~/stores/waitlist'

const props = defineProps<{ token: string | null }>()

const { t } = useI18n()
const store = useWaitlistStore()
const online = useOnline()
const id = useId()

const email = ref('')
const website = ref('')
const sending = ref(false)
const joined = ref(false)
const problem = ref<'invalid' | 'rate_limited' | 'unknown' | null>(null)

async function submit() {
  if (sending.value || !online.value) return
  problem.value = null
  if (!looksLikeEmail(email.value)) {
    problem.value = 'invalid'
    return
  }
  sending.value = true
  const error = await store.join(email.value.trim(), props.token, website.value)
  sending.value = false
  if (error === 'offline') return
  if (error) {
    problem.value = error
    return
  }
  joined.value = true
}

const fieldError = computed(() => (problem.value === 'invalid' ? t('readingPage.waitlist.invalid') : null))
const failure = computed(() => (problem.value === 'rate_limited' ? t('readingPage.waitlist.rateLimited') : problem.value === 'unknown' ? t('readingPage.waitlist.error') : null))
</script>

<template>
  <section :aria-labelledby="`${id}-title`" class="flex w-full flex-col gap-md text-left" data-testid="readingPage.waitlist">
    <div v-if="joined" role="status" class="flex flex-col gap-xs" data-testid="readingPage.waitlistDone">
      <h2 :id="`${id}-title`" class="book-title text-title">{{ t('readingPage.waitlist.doneTitle') }}</h2>
      <p class="text-subhead text-ink-muted">{{ t('readingPage.waitlist.doneText') }}</p>
    </div>

    <template v-else>
      <div class="flex flex-col gap-xs">
        <h2 :id="`${id}-title`" class="book-title text-title">{{ t('readingPage.waitlist.title') }}</h2>
        <p class="text-subhead text-ink-muted">{{ t('readingPage.waitlist.text') }}</p>
      </div>

      <form class="flex flex-col gap-md" novalidate data-testid="readingPage.waitlistForm" @submit.prevent="submit">
        <UiField
          :id="`${id}-email`"
          v-model="email"
          type="email"
          name="email"
          autocomplete="email"
          inputmode="email"
          enterkeyhint="send"
          autocapitalize="none"
          spellcheck="false"
          :label="t('readingPage.waitlist.email')"
          :placeholder="t('readingPage.waitlist.placeholder')"
          :error="fieldError"
          error-testid="readingPage.waitlistInvalid"
          data-testid="readingPage.waitlistEmail"
          @input="problem === 'invalid' && (problem = null)"
        />

        <!-- The honeypot: nobody sees it, nobody tabs to it, a screen reader skips it; a bot fills every field. -->
        <div class="sr-only" aria-hidden="true">
          <label :for="`${id}-website`">{{ t('readingPage.waitlist.honeypot') }}</label>
          <input :id="`${id}-website`" v-model="website" type="text" name="website" tabindex="-1" autocomplete="off" data-testid="readingPage.waitlistWebsite" />
        </div>

        <p v-if="failure" class="text-footnote text-error" role="alert" data-testid="readingPage.waitlistError">{{ failure }}</p>

        <UiButton type="submit" tone="primary" size="md" :disabled="sending" :offline="!online" data-testid="readingPage.waitlistJoin">
          {{ sending ? t('readingPage.waitlist.joining') : problem === 'unknown' ? t('readingPage.waitlist.retry') : t('readingPage.waitlist.join') }}
        </UiButton>
      </form>

      <p class="text-footnote text-ink-faint" data-testid="readingPage.waitlistConsent">{{ t('readingPage.waitlist.consent') }}</p>
    </template>
  </section>
</template>
