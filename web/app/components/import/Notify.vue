<script setup lang="ts">
// "Notify me when it's done" on the import page while the server's job is live (Web Push, stores/importPush.ts): the one button that
// asks the browser's permission (on her tap, never on load), then "We'll notify you when it's done" with a way to turn it off, or why it
// cannot be: blocked in the browser's settings, or an iPhone/iPad outside the Home Screen app (Safari has no push in a tab). Presentational:
// the store's state comes in, her taps go out. The polite status says the change once; the words around it are plain text.
import type { PushView } from '~/stores/importPush'

defineProps<{
  view: PushView
  busy: boolean
  problem: 'failed' | 'offline' | null
  said: 'on' | 'off' | null
  /** The device has no connection: the button says so instead of asking (`UiButton offline`). */
  offline?: boolean
}>()
defineEmits<{ enable: []; disable: [] }>()

const { t } = useI18n()
</script>

<template>
  <section v-if="view !== 'hidden'" class="mt-lg flex flex-col gap-xs" data-testid="import.notify" :data-view="view" :aria-label="t('import.notify.ask')">
    <!-- One polite status for the change (on / off); the button and the words below are not announced twice. -->
    <p class="sr-only" role="status" data-testid="import.notify.say">{{ said ? t(`import.notify.say.${said}`) : '' }}</p>

    <template v-if="view === 'ask'">
      <UiButton block tone="secondary" :offline="offline" :disabled="busy" data-testid="import.notify.enable" @click="$emit('enable')">
        <UiIcon name="bell" :size="18" />
        {{ t('import.notify.ask') }}
      </UiButton>
      <p class="px-xs text-center text-footnote text-ink-faint" data-testid="import.notify.hint">{{ t('import.notify.askHint') }}</p>
      <p v-if="problem" class="px-xs text-center text-caption text-error" role="alert" data-testid="import.notify.problem">
        {{ problem === 'offline' ? t('import.startError.offline') : t('import.notify.failed') }}
      </p>
    </template>

    <div v-else-if="view === 'on'" class="flex items-center gap-ms px-xs" data-testid="import.notify.on">
      <UiIcon name="check" :size="18" class="shrink-0 text-accent" />
      <p class="min-w-0 flex-1 text-subhead text-ink">{{ t('import.notify.on') }}</p>
      <UiButton size="sm" tone="plain" :disabled="busy" data-testid="import.notify.disable" @click="$emit('disable')">{{ t('import.notify.off') }}</UiButton>
    </div>

    <p v-else-if="view === 'blocked'" class="px-xs text-center text-footnote text-ink-muted" data-testid="import.notify.blocked">
      {{ t('import.notify.blocked') }}
    </p>

    <p v-else class="px-xs text-center text-footnote text-ink-muted" data-testid="import.notify.install">{{ t('import.notify.install') }}</p>
  </section>
</template>
