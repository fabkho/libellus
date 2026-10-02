<script setup lang="ts">
import { useSessionStore } from '~/stores/session'

// The signed-in shell: a header with the avatar, the page, a tab bar. A phone
// layout first; on a wide screen the same layout sits in a centred column.
const { t } = useI18n()
const session = useSessionStore()
const route = useRoute()

const TABS = [
  { key: 'home', to: '/' },
  { key: 'library', to: '/library' },
  { key: 'search', to: '/search' },
] as const

const initials = computed(() => initialsOf(session.member?.email ?? ''))

// The avatar's menu: one action today. Closed by a tap anywhere else, Escape,
// or moving to another tab.
const menuOpen = ref(false)
const menu = useTemplateRef<HTMLElement>('menu')

function closeOnOutside(event: PointerEvent) {
  if (menu.value && !menu.value.contains(event.target as Node)) menuOpen.value = false
}
function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') menuOpen.value = false
}
onMounted(() => {
  window.addEventListener('pointerdown', closeOnOutside)
  window.addEventListener('keydown', closeOnEscape)
})
onUnmounted(() => {
  window.removeEventListener('pointerdown', closeOnOutside)
  window.removeEventListener('keydown', closeOnEscape)
})
watch(() => route.path, () => (menuOpen.value = false))

async function signOut() {
  menuOpen.value = false
  await session.signOut()
  await navigateTo('/sign-in')
}
</script>

<template>
  <div
    class="safe-x mx-auto flex min-h-dvh w-full max-w-(--size-max-content) flex-col bg-surface sm:border-x sm:border-outline"
  >
    <header
      class="safe-top sticky top-0 z-10 border-b border-outline bg-surface"
      data-testid="shell.header"
    >
      <div class="flex min-h-(--size-touch) items-center justify-between px-screen py-sm">
        <span class="text-label font-semibold text-ink">{{ t('app.name') }}</span>

        <div ref="menu" class="relative">
          <button
            type="button"
            :aria-label="t('shell.avatarLabel')"
            :aria-expanded="menuOpen"
            aria-haspopup="menu"
            class="flex size-(--size-touch) items-center justify-center rounded-pill bg-accent text-label font-semibold text-on-accent"
            data-testid="shell.avatar"
            @click="menuOpen = !menuOpen"
          >
            {{ initials }}
          </button>

          <div
            v-if="menuOpen"
            role="menu"
            class="absolute right-0 top-full z-20 mt-xs flex w-64 flex-col gap-xs rounded-md border border-outline bg-surface-raised p-sm"
            data-testid="shell.menu"
          >
            <p class="px-sm py-xs text-caption text-ink-muted break-all" data-testid="shell.email">
              {{ t('shell.signedInAs', { email: session.member?.email ?? '' }) }}
            </p>
            <button
              type="button"
              role="menuitem"
              class="min-h-(--size-touch) rounded-sm px-sm text-left text-body text-ink"
              data-testid="shell.signOut"
              @click="signOut"
            >
              {{ t('shell.signOut') }}
            </button>
          </div>
        </div>
      </div>
    </header>

    <main class="flex-1 px-screen py-lg">
      <slot />
    </main>

    <nav
      :aria-label="t('shell.tabsLabel')"
      class="safe-bottom sticky bottom-0 z-10 border-t border-outline bg-surface"
      data-testid="shell.tabs"
    >
      <ul class="flex">
        <li v-for="tab in TABS" :key="tab.key" class="flex-1">
          <NuxtLink
            :to="tab.to"
            class="flex min-h-(--size-touch) items-center justify-center py-sm text-label"
            :class="route.path === tab.to ? 'font-semibold text-ink' : 'text-ink-muted'"
            :data-testid="`shell.tab.${tab.key}`"
          >
            {{ t(`tabs.${tab.key}`) }}
          </NuxtLink>
        </li>
      </ul>
    </nav>
  </div>
</template>
