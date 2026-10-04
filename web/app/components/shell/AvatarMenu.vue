<script setup lang="ts">
// The avatar in the header and its small menu. There is no profile screen
// (issue #1, Screens and navigation): the account, the theme switch and
// signing out live here, and later anything else account-related — the first
// name for Home's greeting is one (the Name row opens its sheet). Closed by a
// tap anywhere else, Escape, the system Back (useBackDismiss.ts), or moving to
// another page; flipping the theme
// keeps it open so the member sees the change.
import { useSessionStore } from '~/stores/session'
import { useThemeStore } from '~/stores/theme'

const { t } = useI18n()
const session = useSessionStore()
const theme = useThemeStore()
const route = useRoute()

const initials = computed(() => initialsOf(session.member?.email ?? '', session.member?.name))
const isDark = computed(() => theme.theme === 'dark')

const open = ref(false)
const root = useTemplateRef<HTMLElement>('root')

// A tap elsewhere closes it once the finger lifts, not as it lands: Android's
// back gesture starts with a touch the system then takes over (the page gets
// `pointercancel`, never `pointerup`), and that Back closes the menu itself —
// closing on the touch as well would spend a second Back on leaving the page.
let pressedOutside: number | null = null
function pressOutside(event: PointerEvent) {
  pressedOutside = root.value && !root.value.contains(event.target as Node) ? event.pointerId : null
}
function closeOnOutside(event: PointerEvent) {
  if (event.pointerId === pressedOutside) open.value = false
  pressedOutside = null
}
function forgetPress() {
  pressedOutside = null
}
function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}
onMounted(() => {
  window.addEventListener('pointerdown', pressOutside)
  window.addEventListener('pointerup', closeOnOutside)
  window.addEventListener('pointercancel', forgetPress)
  window.addEventListener('keydown', closeOnEscape)
})
onUnmounted(() => {
  window.removeEventListener('pointerdown', pressOutside)
  window.removeEventListener('pointerup', closeOnOutside)
  window.removeEventListener('pointercancel', forgetPress)
  window.removeEventListener('keydown', closeOnEscape)
})
watch(() => route.path, () => (open.value = false))
useBackDismiss(open, () => (open.value = false))

// The menu closes as the name sheet rises.
const naming = ref(false)
function openName() {
  open.value = false
  naming.value = true
}

async function signOut() {
  open.value = false
  await session.signOut()
  await navigateTo('/sign-in')
}
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      :aria-label="t('shell.avatarLabel')"
      :aria-expanded="open"
      aria-haspopup="menu"
      class="-mr-sm flex size-(--size-touch) items-center justify-center"
      data-testid="shell.avatar"
      @click="open = !open"
    >
      <UiAvatar :initials="initials" />
    </button>

    <Transition name="menu">
      <div
        v-if="open"
        role="menu"
        class="absolute top-full right-0 z-30 mt-xs flex w-(--size-menu) origin-top-right flex-col overflow-hidden rounded-field bg-surface-raised edge shadow-palette"
        data-testid="shell.menu"
      >
        <div class="flex flex-col gap-xs px-inset pt-inset pb-ms">
          <p class="eyebrow">{{ t('shell.signedInAs') }}</p>
          <p class="truncate text-caption text-ink" :title="session.member?.email" data-testid="shell.email">
            {{ session.member?.email ?? '' }}
          </p>
        </div>

        <div class="border-t-(length:--stroke-hairline) border-hairline-strong">
          <button
            type="button"
            role="menuitem"
            class="flex h-(--size-row) w-full items-center gap-ms px-inset text-left text-body text-ink hover:bg-fill active:bg-fill-strong"
            data-testid="shell.name"
            @click="openName"
          >
            <UiIcon name="pencil" :size="18" class="text-ink-faint" />
            <span class="shrink-0">{{ t('account.name') }}</span>
            <span
              class="min-w-0 flex-1 truncate text-right"
              :class="session.member?.name ? 'text-ink-muted' : 'text-ink-ghost'"
              data-testid="shell.nameValue"
            >
              {{ session.member?.name ?? t('account.nameNone') }}
            </span>
          </button>

          <button
            type="button"
            role="menuitemcheckbox"
            :aria-checked="isDark"
            class="flex h-(--size-row) w-full items-center gap-ms border-t-(length:--stroke-hairline) border-hairline px-inset text-left text-body text-ink hover:bg-fill active:bg-fill-strong"
            data-testid="shell.theme"
            @click="theme.toggle()"
          >
            <UiIcon :name="isDark ? 'moon' : 'sun'" :size="18" class="text-ink-faint" />
            <span class="flex-1">{{ t('shell.darkTheme') }}</span>
            <span
              class="switch flex w-(--size-switch) shrink-0 rounded-pill p-xxs"
              :class="isDark ? 'bg-accent' : 'bg-fill-strong'"
              aria-hidden="true"
            >
              <span class="knob size-(--size-switch-thumb) rounded-pill bg-surface-raised shadow-button" :class="isDark && 'on'" />
            </span>
          </button>

          <NuxtLink
            to="/import"
            role="menuitem"
            class="flex h-(--size-row) w-full items-center gap-ms border-t-(length:--stroke-hairline) border-hairline px-inset text-left text-body text-ink hover:bg-fill active:bg-fill-strong"
            data-testid="shell.import"
            @click="open = false"
          >
            <UiIcon name="import" :size="18" class="text-ink-faint" />
            {{ t('import.menuItem') }}
          </NuxtLink>

          <button
            type="button"
            role="menuitem"
            class="flex h-(--size-row) w-full items-center gap-ms border-t-(length:--stroke-hairline) border-hairline px-inset text-left text-body text-ink hover:bg-fill active:bg-fill-strong"
            data-testid="shell.signOut"
            @click="signOut"
          >
            <UiIcon name="signOut" :size="18" class="text-ink-faint" />
            {{ t('shell.signOut') }}
          </button>
        </div>
      </div>
    </Transition>

    <ShellNameSheet v-model:open="naming" />
  </div>
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

.menu-enter-active {
  transition:
    opacity var(--duration-standard) var(--ease-standard),
    transform var(--duration-standard) var(--ease-standard);
}
.menu-leave-active {
  transition:
    opacity var(--duration-exit) var(--ease-exit),
    transform var(--duration-exit) var(--ease-exit);
}
.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(calc(-1 * var(--spacing-xs)));
}
</style>
