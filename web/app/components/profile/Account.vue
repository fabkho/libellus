<script setup lang="ts">
// The account, at the end of the Profile (issue #78; what the avatar menu held
// before): the address over grouped rows — Name (its sheet), Book links (its sheet, #116), the Dark mode
// switch (docs/DESIGN.md, Themes: the first tap stores the opposite of what
// shows), Import books, Install app (Android's Chrome only, once it has offered the
// install: composables/useInstallHint.ts), Sign out, Delete account. Signing out deletes the writes still waiting
// to sync (a shared phone, #93), so with any waiting it asks first: "Sync first"
// (online: send them, then sign out), "Sign out anyway", Cancel.
// Delete account (#101, Play's in-app deletion): online only (the row is disabled
// and says "Offline"), behind a Confirm that says what goes and that it cannot be
// undone; writes still waiting to sync are named in it and discarded with the rest.
// Afterwards she is on Sign in, which says the account was deleted.
// Errors (the owner's account only, stores/ownerErrors.ts), after Book links: the client error
// log's page, with how many groups first appeared in the last 24 hours as a badge.
// Ebooks on this device (#131), where the browser can keep files: the Ebook folder
// (Chrome only: its name, a tap picks it; Scan beside it asks for the folder's
// permission on that tap when Android has forgotten it, scans, and opens the
// ebooks page with what it found), and Ebooks (how many need her, else how many
// are linked) leading to that page, and Classic reader (the built-in reader's
// other style, a setting of this device).
import { useEbooksStore } from '~/stores/ebooks'
import { useReaderStore } from '~/stores/reader'
import { useSessionStore } from '~/stores/session'
import { useSyncStore } from '~/stores/sync'
import { useLinkTemplatesStore } from '~/stores/linkTemplates'
import { useOwnerErrorsStore } from '~/stores/ownerErrors'
import { useThemeStore } from '~/stores/theme'

const { t } = useI18n()
const session = useSessionStore()
const theme = useThemeStore()
const isDark = computed({
  get: () => theme.theme === 'dark',
  set: (dark: boolean) => dark !== (theme.theme === 'dark') && theme.toggle(),
})
const naming = ref(false)
// Book links (#116): her own, how many; read when the Profile opens.
const linking = ref(false)
const links = useLinkTemplatesStore()
const linkCount = computed(() => links.own?.length ?? 0)
onMounted(() => void links.load())
// Errors (the owner's, and nobody else's: the store neither asks nor shows for another member).
const errors = useOwnerErrorsStore()
onMounted(() => void errors.load())
const sync = useSyncStore()
const online = useOnline()

/** The question before signing out with changes waiting to sync; their number when it was asked. */
const unsynced = ref(0)
const asking = computed({
  get: () => unsynced.value > 0,
  set: (value) => {
    if (!value) unsynced.value = 0
  },
})
const syncing = ref(false)
const syncFailed = ref(false)

function askSignOut() {
  syncFailed.value = false
  if (sync.pending) unsynced.value = sync.pending
  else void signOut()
}
const installApp = useInstallHint()

const ebooks = useEbooksStore()
const reader = useReaderStore()
const readerClassic = computed({
  get: () => reader.settings.style === 'classic',
  set: (on: boolean) => (reader.settings.style = on ? 'classic' : 'printed'),
})
const ebooksValue = computed(() => {
  const waiting = ebooks.waiting.length
  if (waiting) return t('profile.account.ebooksNeedYou', { count: waiting }, waiting)
  return ebooks.linked.length ? String(ebooks.linked.length) : ''
})
async function scanEbooks() {
  if (await ebooks.scan()) await navigateTo('/ebooks')
  else if (ebooks.error) await navigateTo('/ebooks')
}

/** The Delete account Confirm; the number of unsynced changes when it was asked. */
const deleting = ref(false)
const deleteUnsynced = ref(0)
const deleteFailed = ref(false)

function askDelete() {
  deleteFailed.value = false
  deleteUnsynced.value = sync.pending
  deleting.value = true
}

async function deleteAccount() {
  deleteFailed.value = false
  const error = await session.deleteAccount()
  if (error) {
    deleteFailed.value = true
    return
  }
  deleting.value = false
  await navigateTo('/sign-in')
}

async function signOut() {
  unsynced.value = 0
  await session.signOut()
  await navigateTo('/sign-in')
}

/** "Sync first": the waiting changes go now; once none is left, she is signed out. */
async function syncFirst() {
  syncing.value = true
  syncFailed.value = false
  try {
    if (await sync.syncNow()) await signOut()
    else {
      syncFailed.value = true
      unsynced.value = sync.pending
    }
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <section id="account" class="flex flex-col gap-sm" data-testid="profile.account">
    <div class="flex items-baseline justify-between gap-md">
      <h2 class="eyebrow shrink-0">{{ t('profile.account.title') }}</h2>
      <span class="figures truncate text-meta text-ink-faint" :title="session.member?.email" data-testid="profile.email">{{ session.member?.email ?? '' }}</span>
    </div>
    <UiRowGroup>
      <UiRow as="button" icon="pencil" :label="t('account.name')" chevron data-testid="profile.name" @click="naming = true">
        <span :class="session.member?.name ? 'text-ink-muted' : 'text-ink-faint'" data-testid="profile.nameValue">{{ session.member?.name ?? t('account.nameNone') }}</span>
      </UiRow>
      <UiRow as="button" icon="globe" :label="t('links.row')" chevron data-testid="profile.links" @click="linking = true">
        <span :class="linkCount ? 'figures text-ink-muted' : 'text-ink-faint'" data-testid="profile.linksValue">{{ linkCount || t('links.rowNone') }}</span>
      </UiRow>
      <UiRow v-if="errors.isOwner" to="/profile/errors" icon="flag" :label="t('ownerErrors.row')" chevron data-testid="profile.errors">
        <span
          v-if="errors.fresh"
          class="figures rounded-pill bg-accent-soft px-sm text-meta text-accent"
          :aria-label="t('ownerErrors.rowNew', { count: errors.fresh })"
          data-testid="profile.errorsNew"
        >{{ errors.fresh }}</span>
        <span v-else-if="errors.groups?.length" class="figures text-ink-muted" data-testid="profile.errorsValue">{{ errors.groups.length }}</span>
        <span v-else-if="errors.groups" class="text-ink-ghost" data-testid="profile.errorsValue">{{ t('ownerErrors.rowNone') }}</span>
      </UiRow>
      <UiSwitchRow v-model="isDark" :icon="isDark ? 'moon' : 'sun'" :label="t('profile.account.theme')" testid="profile.theme" />
      <UiRow v-if="ebooks.folderSupported" icon="library" :label="t('profile.account.ebookFolder')" data-testid="profile.ebookFolderRow">
        <button
          type="button"
          class="-my-sm min-h-(--size-touch) min-w-0 truncate px-xs"
          :class="ebooks.folder ? 'figures text-ink-muted' : 'text-ink-faint'"
          data-testid="profile.ebookFolder"
          @click="ebooks.pickFolder()"
        >
          {{ ebooks.folder?.name ?? t('profile.account.ebookFolderNone') }}
        </button>
        <template v-if="ebooks.folder" #trailing>
          <UiButton tone="quiet" size="sm" class="-mr-xs" :disabled="Boolean(ebooks.busy)" data-testid="profile.ebookScan" @click="scanEbooks">
            {{ ebooks.busy?.source === 'folder' ? t('profile.account.scanning') : t('profile.account.scan') }}
          </UiButton>
        </template>
      </UiRow>
      <UiRow v-if="ebooks.supported" to="/ebooks" icon="ebook" :label="t('profile.account.ebooks')" chevron data-testid="profile.ebooks">
        <span v-if="ebooksValue" :class="ebooks.waiting.length ? 'text-ink' : 'figures text-ink-muted'" data-testid="profile.ebooksValue">{{ ebooksValue }}</span>
      </UiRow>
      <!-- The built-in reader's other style (#131 phase 2); the reader's Aa sheet has it too. -->
      <UiSwitchRow v-if="ebooks.supported" v-model="readerClassic" icon="read" :label="t('profile.account.readerClassic')" testid="profile.readerClassic" />
      <UiRow to="/import" icon="import" :label="t('import.menuItem')" chevron data-testid="profile.import" />
      <UiRow
        v-if="installApp.canInstall.value"
        as="button"
        icon="plus"
        :label="t('profile.account.install')"
        data-testid="profile.install"
        @click="installApp.install()"
      />
      <UiRow as="button" icon="signOut" :label="t('profile.account.signOut')" data-testid="profile.signOut" @click="askSignOut" />
      <UiRow
        as="button"
        icon="trash"
        tone="danger"
        :label="t('profile.account.delete')"
        :disabled="!online"
        class="disabled:opacity-50"
        data-testid="profile.delete"
        @click="askDelete"
      >
        <span v-if="!online" class="text-ink-muted">{{ t('common.offline') }}</span>
      </UiRow>
    </UiRowGroup>
    <ShellNameSheet v-model:open="naming" />
    <ProfileLinksSheet v-model:open="linking" />
    <UiConfirm
      v-model:open="asking"
      :title="t('profile.signOutUnsynced.title', { count: unsynced }, unsynced)"
      :text="t('profile.signOutUnsynced.text', unsynced)"
      :alternative="online ? (syncing ? t('profile.signOutUnsynced.syncing') : t('profile.signOutUnsynced.syncFirst')) : undefined"
      :action="t('profile.signOutUnsynced.signOut')"
      :busy="syncing"
      :error="syncFailed ? t('profile.signOutUnsynced.failed') : null"
      testid="signOutUnsynced"
      @alternative="syncFirst"
      @confirm="signOut"
    />
    <UiConfirm
      v-model:open="deleting"
      :title="t('profile.deleteAccount.title')"
      :text="t('profile.deleteAccount.text') + (deleteUnsynced ? ' ' + t('profile.deleteAccount.unsynced', { count: deleteUnsynced }, deleteUnsynced) : '')"
      :action="t('profile.deleteAccount.action')"
      :busy="session.deleting"
      :offline="!online"
      :error="deleteFailed ? t('profile.deleteAccount.failed') : null"
      testid="deleteAccount"
      @confirm="deleteAccount"
    />
  </section>
</template>
