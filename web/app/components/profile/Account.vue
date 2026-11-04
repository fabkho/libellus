<script setup lang="ts">
// The account, at the end of the Profile (issue #78; what the avatar menu held
// before): the address over grouped rows — Name (its sheet, opened by the page: the hero's name opens it too), Book links (its sheet, #116), Profile links (her profiles on other platforms, WP-22, components/profile/SocialLinksSheet.vue), the Dark mode
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
// Waitlist (the owner's account only, stores/waitlist.ts), after Errors: the people who asked for an invite
// on a reading page (#171), with how many still wait as its value.
// Ebooks on this device (#131), where the browser can keep files: one row, Ebooks
// (how many need her, else how many are linked), leading to the Ebooks page, where
// the ebook folder is chosen and scanned. The reader's Classic style is set in the
// reader's own Aa sheet only. Under the rows: Version x.y.z · What's new, which opens
// the release's notes (composables/useWhatsNew.ts).
// Glass (the owner's account only, stores/glass.ts), under Dark mode: how glassy the floating
// chrome is on this device — Strong, Medium, Off (no transparency at all), a segmented choice in
// the row — to compare on a phone.
import { useAppUpdateStore, type UpdateResult } from '~/stores/appUpdate'
import { useAvatarStore } from '~/stores/avatar'
import { useFriendsTabStore } from '~/stores/friendsTab'
import { useGlassStore } from '~/stores/glass'
import { useEbooksStore } from '~/stores/ebooks'
import { useSessionStore } from '~/stores/session'
import { useSyncStore } from '~/stores/sync'
import { useLinkTemplatesStore } from '~/stores/linkTemplates'
import { useProfileLinksStore } from '~/stores/profileLinks'
import { useOwnerErrorsStore } from '~/stores/ownerErrors'
import { useWaitlistStore } from '~/stores/waitlist'
import { useThemeStore } from '~/stores/theme'
import { GLASS_LEVELS, type GlassLevel } from '~/utils/glass'

const emit = defineEmits<{ photo: []; name: [] }>()
const { t } = useI18n()
const session = useSessionStore()
const avatar = useAvatarStore()
const theme = useThemeStore()
const isDark = computed({
  get: () => theme.theme === 'dark',
  set: (dark: boolean) => dark !== (theme.theme === 'dark') && theme.toggle(),
})
// Book links (#116): her own, how many; read when the Profile opens.
const linking = ref(false)
const links = useLinkTemplatesStore()
const linkCount = computed(() => links.own?.length ?? 0)
onMounted(() => void links.load())
// Profile links (WP-22): her profiles on other platforms, how many; read when the Profile opens.
const socialLinking = ref(false)
const profileLinks = useProfileLinksStore()
const socialCount = computed(() => profileLinks.own?.links.length ?? 0)
onMounted(() => void profileLinks.load())
// Errors (the owner's, and nobody else's: the store neither asks nor shows for another member).
const errors = useOwnerErrorsStore()
onMounted(() => void errors.load())
// Waitlist (#171): the owner's too, with the same guard.
const waitlist = useWaitlistStore()
onMounted(() => void waitlist.load())
// Friends tab: the feed in the tab bar, on until she turns it off (stores/friendsTab.ts).
const friendsTab = useFriendsTabStore()
const showFriendsTab = computed({ get: () => friendsTab.enabled, set: (on: boolean) => friendsTab.set(on) })

// Glass: the owner's, like Errors.
const glass = useGlassStore()
const glassLevel = computed({ get: () => glass.level, set: (level: GlassLevel) => glass.set(level) })
const glassOptions = computed(() => GLASS_LEVELS.map((value) => ({ value, label: t(`profile.account.glassLevel.${value}`) })))
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

// A new release of the installed app (stores/appUpdate.ts, docs/parity.md "App update"): the row under
// Install app looks now, and says what it found under the rows. Nothing here writes, so being offline is
// only ever the look's own answer ("that did not work").
const appUpdate = useAppUpdateStore()
/** The line under the rows, by what the last look found. */
const UPDATE_RESULT: Record<UpdateResult, string> = {
  idle: '',
  checking: 'profile.account.updateChecking',
  current: 'profile.account.updateCurrent',
  available: 'profile.account.updateAvailable',
  failed: 'profile.account.updateFailed',
}

/** "Check for new version": look now, say what it found, and offer the sheet when there is something. */
async function checkForUpdate() {
  if (appUpdate.checking) return
  if ((await appUpdate.check({ manual: true })) === 'available') appUpdate.reopen()
}

const ebooks = useEbooksStore()
const ebooksValue = computed(() => {
  const waiting = ebooks.waiting.length
  if (waiting) return t('profile.account.ebooksNeedYou', { count: waiting }, waiting)
  return ebooks.linked.length ? String(ebooks.linked.length) : ''
})

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

// Under the rows, quietly: which release this is, and its notes (the What's new sheet, layouts/tabs.vue).
const whatsNew = useWhatsNew()
</script>

<template>
  <section id="account" class="flex flex-col gap-sm" data-testid="profile.account">
    <div class="flex items-baseline justify-between gap-md">
      <h2 class="eyebrow shrink-0">{{ t('profile.account.title') }}</h2>
      <span class="figures truncate text-meta text-ink-faint" :title="session.member?.email" data-testid="profile.email">{{ session.member?.email ?? '' }}</span>
    </div>
    <UiRowGroup>
      <UiRow
        as="button"
        icon="camera"
        :label="t('photo.row')"
        chevron
        :disabled="!online"
        class="disabled:opacity-50"
        data-testid="profile.photo"
        @click="emit('photo')"
      >
        <span v-if="!online" class="text-ink-muted">{{ t('common.offline') }}</span>
        <UiAvatar v-else-if="avatar.small" :initials="''" :photo="avatar.small" data-testid="profile.photoValue" />
        <span v-else class="text-ink-faint" data-testid="profile.photoValue">{{ t('photo.rowNone') }}</span>
      </UiRow>
      <UiRow as="button" icon="pencil" :label="t('account.name')" chevron data-testid="profile.name" @click="emit('name')">
        <span :class="session.member?.name ? 'text-ink-muted' : 'text-ink-faint'" data-testid="profile.nameValue">{{ session.member?.name ?? t('account.nameNone') }}</span>
      </UiRow>
      <UiRow as="button" icon="globe" :label="t('links.row')" chevron data-testid="profile.links" @click="linking = true">
        <span :class="linkCount ? 'figures text-ink-muted' : 'text-ink-faint'" data-testid="profile.linksValue">{{ linkCount || t('links.rowNone') }}</span>
      </UiRow>
      <UiRow as="button" icon="people" :label="t('socialLinks.row')" chevron data-testid="profile.socialLinks" @click="socialLinking = true">
        <span :class="socialCount ? 'figures text-ink-muted' : 'text-ink-faint'" data-testid="profile.socialLinksValue">{{ socialCount || t('socialLinks.rowNone') }}</span>
      </UiRow>
      <UiRow v-if="errors.isOwner" to="/profile/errors" icon="flag" :label="t('ownerErrors.row')" chevron data-testid="profile.errors">
        <span
          v-if="errors.fresh"
          class="figures rounded-pill bg-accent-soft px-sm text-meta text-accent-ink"
          :aria-label="t('ownerErrors.rowNew', { count: errors.fresh })"
          data-testid="profile.errorsNew"
        >{{ errors.fresh }}</span>
        <span v-else-if="errors.groups?.length" class="figures text-ink-muted" data-testid="profile.errorsValue">{{ errors.groups.length }}</span>
        <span v-else-if="errors.groups" class="text-ink-faint" data-testid="profile.errorsValue">{{ t('ownerErrors.rowNone') }}</span>
      </UiRow>
      <UiRow v-if="waitlist.isOwner" to="/profile/waitlist" icon="mail" :label="t('waitlist.row')" chevron data-testid="profile.waitlist">
        <span v-if="waitlist.waitingCount" class="figures text-ink-muted" data-testid="profile.waitlistValue">{{ t('waitlist.rowValue', { count: waitlist.waitingCount }) }}</span>
        <span v-else-if="waitlist.waitingCount !== null" class="text-ink-faint" data-testid="profile.waitlistValue">{{ t('waitlist.rowNone') }}</span>
      </UiRow>
      <UiSwitchRow v-model="isDark" :icon="isDark ? 'moon' : 'sun'" :label="t('profile.account.theme')" testid="profile.theme" />
      <ProfileLanguage />
      <UiRow v-if="errors.isOwner" icon="stack" :label="t('profile.account.glass')">
        <template #trailing>
          <UiSegmented v-model="glassLevel" compact :options="glassOptions" :label="t('profile.account.glass')" testid="profile.glass" />
        </template>
      </UiRow>
      <UiRow v-if="ebooks.supported" to="/ebooks" icon="ebook" :label="t('profile.account.ebooks')" chevron data-testid="profile.ebooks">
        <span v-if="ebooksValue" :class="ebooks.waiting.length ? 'text-ink' : 'figures text-ink-muted'" data-testid="profile.ebooksValue">{{ ebooksValue }}</span>
      </UiRow>
      <UiRow to="/import" icon="import" :label="t('import.menuItem')" chevron data-testid="profile.import" />
      <UiRow
        v-if="installApp.canInstall.value"
        as="button"
        icon="plus"
        :label="t('profile.account.install')"
        data-testid="profile.install"
        @click="installApp.install()"
      />
      <UiRow
        as="button"
        icon="repeat"
        :label="t('profile.account.update')"
        data-testid="profile.update"
        @click="checkForUpdate"
      >
        <span v-if="appUpdate.checking" class="text-ink-faint" data-testid="profile.updateValue">{{ t('profile.account.updateChecking') }}</span>
        <span v-else-if="whatsNew.notes.version" class="figures text-ink-muted" data-testid="profile.updateValue">{{ whatsNew.notes.version }}</span>
      </UiRow>
      <UiSwitchRow v-model="showFriendsTab" icon="people" :label="t('profile.account.friendsTab')" testid="profile.friendsTab" />
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
    <!-- What the last look for a new version found (stores/appUpdate.ts); "Show" brings the sheet back
         after "Later". Politeness per result: a failure is an alert, everything else is a status. -->
    <div v-if="appUpdate.result !== 'idle'" class="flex items-center justify-between gap-sm px-inset">
      <p
        class="text-caption"
        :class="appUpdate.result === 'failed' ? 'text-error' : 'text-ink-muted'"
        :role="appUpdate.result === 'failed' ? 'alert' : 'status'"
        :data-result="appUpdate.result"
        data-testid="profile.updateResult"
      >
        {{ t(UPDATE_RESULT[appUpdate.result]) }}
      </p>
      <UiButton
        v-if="appUpdate.available && !appUpdate.sheetOpen"
        size="sm"
        tone="secondary"
        data-testid="profile.updateShow"
        @click="appUpdate.reopen()"
      >
        {{ t('profile.account.updateShow') }}
      </UiButton>
    </div>
    <button
      v-if="whatsNew.notes.version"
      type="button"
      class="figures mx-auto min-h-(--size-touch) px-sm text-caption text-ink-faint hover:text-ink-muted"
      data-testid="profile.whatsNew"
      @click="whatsNew.show()"
    >
      {{ t('profile.account.version', { version: whatsNew.notes.version }) }} · <span class="text-accent-ink">{{ t('profile.account.whatsNew') }}</span>
    </button>
    <ProfileLinksSheet v-model:open="linking" />
    <ProfileSocialLinksSheet v-model:open="socialLinking" />
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
