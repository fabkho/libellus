<script setup lang="ts">
// The waitlist, for the instance's owner (issue #171): the addresses of people who asked for an invite on a
// reading page, newest first. Reached from the Profile's Account section (its Waitlist row); only the
// owner's account has it (stores/waitlist.ts), and for anyone else the address is a page that doesn't exist
// (`validate`, the same 404 as any unknown address) and nothing is asked of the server, which refuses them as
// well (`not_owner`). Nothing is mailed from here: she copies the addresses still waiting (comma-separated,
// for a Bcc field), sends the invites herself and marks them invited.
//
// A pushed screen in the tab layout, built like Errors: the round back and a Refresh button in the bar, the
// large title, how many wait and how many were invited, Copy waiting emails, then one row an entry: the address,
// when she joined (relative) and whose page it was ("from Ada's page"), Mark invited (or Invited, which takes
// it back) and Delete behind a Confirm (a request to be forgotten: gone for good). Nobody yet: D's empty state.
// The list cannot be loaded: why, and Try again (a load that fails keeps the entries on screen). Writes are
// disabled and say Offline while the device is (#15).
import { emailsText, waiting, type WaitlistEntry } from '~/data/waitlist'
import { isShelfOwner } from '~/utils/shelfOwner'
import { relativeTime } from '~/utils/relativeTime'
import { useSessionStore } from '~/stores/session'
import { useWaitlistStore } from '~/stores/waitlist'

definePageMeta({
  layout: 'tabs',
  screen: 'waitlist',
  pushed: true,
  // Runs in the app's entry, before this page's chunk loads: the session and the config only.
  validate: () => isShelfOwner(useSessionStore().member?.id, useRuntimeConfig().public.shelfOwnerId),
})

const { t, locale } = useI18n()
const router = useRouter()
const store = useWaitlistStore()
const online = useOnline()
const { count } = useFigures()

useHead({ title: () => `${t('waitlist.title')} · ${t('app.name')}` })

function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo('/profile')
}

onMounted(() => void store.load())
// Back online with nothing to show: load without a tap.
watch(online, (now) => now && store.loadError === 'offline' && void store.load())

const entries = computed(() => store.entries ?? [])
const waitingEntries = computed(() => waiting(entries.value))
const invitedCount = computed(() => entries.value.length - waitingEntries.value.length)
const empty = computed(() => store.entries !== null && !entries.value.length)
const failed = computed(() => store.loadError !== null && store.entries === null)

const now = ref(Date.now())
watch(() => store.entries, () => (now.value = Date.now()))
const meta = (entry: WaitlistEntry) =>
  [relativeTime(entry.joinedAt, now.value, locale.value), entry.memberName ? t('waitlist.fromMember', { name: entry.memberName }) : t('waitlist.fromPage')].join(' · ')

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined
async function copy() {
  const text = emailsText(waitingEntries.value)
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // No clipboard (an insecure origin, a refused permission): select the text the old way.
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    try {
      document.execCommand('copy')
    } finally {
      area.remove()
    }
  }
  copied.value = true
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 1800)
}
onUnmounted(() => clearTimeout(copiedTimer))

const busy = ref<string | null>(null)
async function toggleInvited(entry: WaitlistEntry) {
  if (busy.value) return
  busy.value = entry.id
  await store.setInvited([entry.id], !entry.invitedAt)
  busy.value = null
}

const deleting = ref<WaitlistEntry | null>(null)
const confirmOpen = computed({ get: () => deleting.value !== null, set: (open: boolean) => !open && !removing.value && (deleting.value = null) })
const removing = ref(false)
async function remove() {
  const entry = deleting.value
  if (!entry || removing.value) return
  removing.value = true
  const done = await store.remove(entry.id)
  removing.value = false
  if (done) deleting.value = null
}
// A refusal stays in the Confirm; a new question starts clean.
watch(deleting, () => (store.writeError = null))
</script>

<template>
  <div class="relative min-h-dvh pb-xl">
    <UiTopBar :back-label="t('waitlist.back')" back-testid="waitlist.back" @back="back">
      <template #trailing>
        <UiRoundButton
          icon="repeat"
          :label="store.loading ? t('waitlist.refreshing') : t('waitlist.refresh')"
          :disabled="store.loading || !online"
          :class="store.loading && 'spinning'"
          data-testid="waitlist.refresh"
          @click="store.load()"
        />
      </template>
    </UiTopBar>

    <header class="px-screen pt-bar">
      <h1 class="text-large-title" data-testid="waitlist.title">{{ t('waitlist.title') }}</h1>
      <p class="mt-xs text-subhead text-ink-muted">{{ t('waitlist.intro') }}</p>
    </header>

    <div class="flex flex-col gap-lg px-screen pt-lg">
      <template v-if="entries.length">
        <div class="flex flex-wrap items-center justify-between gap-sm">
          <p class="figures text-subhead text-ink-muted" role="status" data-testid="waitlist.summary">
            {{ t('waitlist.summary', { waiting: count(waitingEntries.length), invited: count(invitedCount) }) }}
          </p>
          <UiButton tone="secondary" size="sm" :disabled="!waitingEntries.length" data-testid="waitlist.copy" @click="copy()">
            <UiIcon name="copy" :size="14" />{{ copied ? t('waitlist.copied') : t('waitlist.copy') }}
          </UiButton>
        </div>

        <ul class="flex flex-col divide-y divide-hairline" data-testid="waitlist.list">
          <li v-for="entry in entries" :key="entry.id" class="flex items-center gap-sm py-md" :class="entry.invitedAt && 'opacity-70'" data-testid="waitlist.entry">
            <div class="flex min-w-0 flex-1 flex-col gap-xxs">
              <span class="wrap-anywhere text-body text-ink" data-testid="waitlist.email">{{ entry.email }}</span>
              <span class="figures text-meta text-ink-faint" data-testid="waitlist.meta">{{ meta(entry) }}</span>
            </div>
            <UiButton
              :tone="entry.invitedAt ? 'quiet' : 'secondary'"
              size="sm"
              :disabled="busy === entry.id"
              :offline="!online"
              data-testid="waitlist.invited"
              @click="toggleInvited(entry)"
            >
              <UiIcon v-if="entry.invitedAt" name="check" :size="14" />{{ entry.invitedAt ? t('waitlist.invitedDone') : t('waitlist.markInvited') }}
            </UiButton>
            <button
              type="button"
              class="relative flex size-(--size-touch) shrink-0 items-center justify-center text-ink-muted disabled:opacity-50"
              :aria-label="t('waitlist.delete', { email: entry.email })"
              :disabled="!online"
              data-testid="waitlist.delete"
              @click="deleting = entry"
            >
              <UiIcon name="trash" :size="20" />
            </button>
          </li>
        </ul>
      </template>

      <p v-if="store.writeError && !deleting" class="text-footnote text-error" role="alert" data-testid="waitlist.writeError">
        {{ store.writeError === 'offline' ? t('waitlist.offline') : t('waitlist.writeError') }}
      </p>

      <UiEmptyState v-else-if="empty" screen="waitlist" :title="t('waitlist.empty.title')" :text="t('waitlist.empty.text')" compact />

      <div v-else-if="failed" class="flex flex-col items-start gap-md" role="alert" data-testid="waitlist.loadFailed">
        <p class="text-subhead text-ink-muted">{{ store.loadError === 'offline' ? t('waitlist.offline') : t('waitlist.loadError') }}</p>
        <UiButton tone="secondary" size="md" :offline="!online" data-testid="waitlist.retry" @click="store.load()">{{ t('waitlist.retry') }}</UiButton>
      </div>
    </div>

    <UiConfirm
      v-model:open="confirmOpen"
      :title="t('waitlist.confirm.title', { email: deleting?.email ?? '' })"
      :text="t('waitlist.confirm.text')"
      :action="t('waitlist.confirm.action')"
      :busy="removing"
      :error="store.writeError && deleting ? (store.writeError === 'offline' ? t('waitlist.offline') : t('waitlist.writeError')) : null"
      :offline="!online"
      testid="waitlist.confirm"
      @confirm="remove()"
    />
  </div>
</template>

<style scoped>
.spinning :deep(svg) {
  animation: spin 900ms linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinning :deep(svg) {
    animation: none;
  }
}
</style>
