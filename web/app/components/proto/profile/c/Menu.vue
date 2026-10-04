<script setup lang="ts">
// Direction C: the avatar menu as it is (ShellAvatarMenu: the address, Name,
// Dark mode, Import, Sign out) — C leaves the account where it is. Dark mode
// flips the prototype's theme.
import { MEMBER, applyTheme, protoTheme } from '../model'

const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
const dark = computed(() => protoTheme.value === 'dark')
const ROW = 'flex h-(--size-row) w-full items-center gap-ms px-inset text-left text-body text-ink hover:bg-fill active:bg-fill-strong'
</script>

<template>
  <div class="relative">
    <button
      type="button"
      :aria-expanded="open"
      aria-haspopup="menu"
      aria-label="Account"
      class="-mr-sm flex size-(--size-touch) items-center justify-center"
      data-testid="c.avatar"
      @click="open = !open"
    >
      <UiAvatar :initials="MEMBER.initials" />
    </button>
    <Transition name="menu">
      <div
        v-if="open"
        role="menu"
        class="absolute top-full right-0 z-30 mt-xs flex w-(--size-menu) origin-top-right flex-col overflow-hidden rounded-field bg-surface-raised edge shadow-palette"
        data-testid="c.menu"
      >
        <div class="flex flex-col gap-xs px-inset pt-inset pb-ms">
          <p class="eyebrow">{{ t('shell.signedInAs') }}</p>
          <p class="truncate text-caption text-ink">{{ MEMBER.email }}</p>
        </div>
        <div class="border-t-(length:--stroke-hairline) border-hairline-strong">
          <button type="button" role="menuitem" :class="ROW">
            <UiIcon name="pencil" :size="18" class="text-ink-faint" />
            <span class="shrink-0">{{ t('account.name') }}</span>
            <span class="min-w-0 flex-1 truncate text-right text-ink-muted">{{ MEMBER.name }}</span>
          </button>
          <button type="button" role="menuitemcheckbox" :aria-checked="dark" :class="ROW" class="border-t-(length:--stroke-hairline) border-hairline" @click="applyTheme(dark ? 'light' : 'dark')">
            <UiIcon :name="dark ? 'moon' : 'sun'" :size="18" class="text-ink-faint" />
            <span class="flex-1">{{ t('shell.darkTheme') }}</span>
            <span class="switch flex w-(--size-switch) shrink-0 rounded-pill p-xxs" :class="dark ? 'bg-accent' : 'bg-fill-strong'" aria-hidden="true">
              <span class="knob size-(--size-switch-thumb) rounded-pill bg-surface-raised shadow-button" :class="dark && 'on'" />
            </span>
          </button>
          <button type="button" role="menuitem" :class="ROW" class="border-t-(length:--stroke-hairline) border-hairline">
            <UiIcon name="import" :size="18" class="text-ink-faint" />{{ t('import.menuItem') }}
          </button>
          <button type="button" role="menuitem" :class="ROW" class="border-t-(length:--stroke-hairline) border-hairline">
            <UiIcon name="signOut" :size="18" class="text-ink-faint" />{{ t('shell.signOut') }}
          </button>
        </div>
      </div>
    </Transition>
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
