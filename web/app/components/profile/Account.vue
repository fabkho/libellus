<script setup lang="ts">
// The account, at the end of the Profile (issue #78; what the avatar menu held
// before): the address over grouped rows — Name (its sheet), the Dark mode
// switch (docs/DESIGN.md, Themes: the first tap stores the opposite of what
// shows), Import books, Sign out.
import { useSessionStore } from '~/stores/session'
import { useThemeStore } from '~/stores/theme'

const { t } = useI18n()
const session = useSessionStore()
const theme = useThemeStore()
const isDark = computed(() => theme.theme === 'dark')
const naming = ref(false)

async function signOut() {
  await session.signOut()
  await navigateTo('/sign-in')
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
      <UiRow as="button" icon="signOut" :label="t('profile.account.signOut')" data-testid="profile.signOut" @click="signOut" />
    </UiRowGroup>
    <ShellNameSheet v-model:open="naming" />
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
