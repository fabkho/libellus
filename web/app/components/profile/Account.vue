<script setup lang="ts">
// The account, at the end of the Profile (issue #78; what the avatar menu held
// before): the address over grouped rows — Name (its sheet), the Dark mode
// switch (docs/DESIGN.md, Themes: the first tap stores the opposite of what
// shows), Import books, Install app (Android's Chrome only, once it has offered the
// install: composables/useInstallHint.ts), Sign out. Signing out deletes the writes still waiting
// to sync (a shared phone, #93), so with any waiting it asks first: "Sync first"
// (online: send them, then sign out), "Sign out anyway", Cancel.
import { useSessionStore } from '~/stores/session'
import { useSyncStore } from '~/stores/sync'
import { useThemeStore } from '~/stores/theme'

const { t } = useI18n()
const session = useSessionStore()
const theme = useThemeStore()
const isDark = computed(() => theme.theme === 'dark')
const naming = ref(false)
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
        <span :class="session.member?.name ? 'text-ink-muted' : 'text-ink-ghost'" data-testid="profile.nameValue">{{ session.member?.name ?? t('account.nameNone') }}</span>
      </UiRow>
      <UiRow
        as="button"
        role="switch"
        :aria-checked="isDark"
        :icon="isDark ? 'moon' : 'sun'"
        :label="t('profile.account.theme')"
        data-testid="profile.theme"
        @click="theme.toggle()"
      >
        <span class="switch flex w-(--size-switch) shrink-0 rounded-pill p-xxs" :class="isDark ? 'bg-accent' : 'bg-fill-strong'" aria-hidden="true">
          <span class="knob size-(--size-switch-thumb) rounded-pill bg-surface-raised shadow-button" :class="isDark && 'on'" />
        </span>
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
      <UiRow as="button" icon="signOut" :label="t('profile.account.signOut')" data-testid="profile.signOut" @click="askSignOut" />
    </UiRowGroup>
    <ShellNameSheet v-model:open="naming" />
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
  </section>
</template>

<style scoped>
.switch {
  transition: background-color var(--duration-quick) var(--ease-standard);
}
.knob {
  transition: transform var(--duration-quick) var(--ease-standard);
}
.knob.on {
  transform: translateX(calc(var(--size-switch) - var(--size-switch-thumb) - 2 * var(--spacing-xxs)));
}
</style>
