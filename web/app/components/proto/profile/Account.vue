<script setup lang="ts">
// Design round #78: what the avatar menu holds today (#1: the address, Name,
// Dark mode, Import, Sign out) as grouped rows at the end of a page — the
// shape A and B give it once the account has a screen. Dark mode flips the
// prototype's theme; the rest only show where they would go.
import { MEMBER, applyTheme, protoTheme } from './model'

const { t } = useI18n()
const dark = computed(() => protoTheme.value === 'dark')
</script>

<template>
  <section id="account" class="flex flex-col gap-sm" data-testid="proto.account">
    <div class="flex items-baseline justify-between gap-md">
      <h2 class="eyebrow">Account</h2>
      <span class="figures truncate text-meta text-ink-faint">{{ MEMBER.email }}</span>
    </div>
    <UiRowGroup>
      <UiRow as="button" icon="pencil" :label="t('account.name')" :value="MEMBER.name" chevron data-testid="proto.account.name" />
      <UiRow as="button" :icon="dark ? 'moon' : 'sun'" :label="t('shell.darkTheme')" data-testid="proto.account.theme" @click="applyTheme(dark ? 'light' : 'dark')">
        <span class="switch flex w-(--size-switch) shrink-0 rounded-pill p-xxs" :class="dark ? 'bg-accent' : 'bg-fill-strong'" aria-hidden="true">
          <span class="knob size-(--size-switch-thumb) rounded-pill bg-surface-raised shadow-button" :class="dark && 'on'" />
        </span>
      </UiRow>
      <UiRow as="button" icon="import" :label="t('import.menuItem')" chevron data-testid="proto.account.import" />
      <UiRow as="button" icon="signOut" :label="t('shell.signOut')" data-testid="proto.account.signOut" />
    </UiRowGroup>
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
