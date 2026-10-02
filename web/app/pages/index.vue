<script setup lang="ts">
// Start page of the scaffold: proves the shell, the tokens, the font and the
// message file are wired up. The tab shell replaces it with sign-in (#3).
const { t } = useI18n()
</script>

<template>
  <main class="screen-inset flex min-h-dvh flex-col items-center justify-center gap-sm bg-surface">
    <h1 class="text-display font-semibold tracking-display text-ink" data-testid="start.title">
      {{ t('app.name') }}
    </h1>
    <p class="text-body text-balance text-center text-ink-muted" data-testid="start.tagline">
      {{ t('start.tagline') }}
    </p>
  </main>
</template>
