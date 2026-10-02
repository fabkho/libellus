<script setup lang="ts">
// A bottom sheet the iOS way: it rises over a scrim with a grabber and a title
// row — a text Cancel at the top left (never a round ✕), the title in the
// middle, the sheet's one action at the right in the lamp colour. Closed by
// Cancel, a tap on the scrim, Escape, or swiping it down. Respects the home
// indicator. `testid` names the sheet; Cancel and the action get
// `<testid>.cancel` and `<testid>.action`.
const open = defineModel<boolean>('open', { required: true })

withDefaults(
  defineProps<{ title: string; testid: string; action?: string; actionDisabled?: boolean }>(),
  { action: undefined, actionDisabled: false },
)
const emit = defineEmits<{ action: [] }>()

const { t } = useI18n()

function close() {
  open.value = false
}

const { handlers, dragStyle } = useSwipeDown(close)

const panel = useTemplateRef<HTMLElement>('panel')
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}
watch(open, async (isOpen) => {
  if (!import.meta.client) return
  if (isOpen) {
    window.addEventListener('keydown', onKeydown)
    await nextTick()
    panel.value?.focus({ preventScroll: true })
  } else {
    window.removeEventListener('keydown', onKeydown)
  }
})
onUnmounted(() => import.meta.client && window.removeEventListener('keydown', onKeydown))

const titleId = useId()
</script>

<template>
  <Teleport to="body">
    <Transition name="scrim">
      <div v-if="open" class="fixed inset-0 z-40 bg-scrim" :data-testid="`${testid}.scrim`" @click="close" />
    </Transition>
    <Transition name="sheet">
      <section
        v-if="open"
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        class="sheet safe-bottom fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-(--size-max-content) flex-col rounded-t-sheet bg-surface-sheet shadow-sheet outline-none"
        :style="dragStyle"
        :data-testid="testid"
        v-on="handlers"
      >
        <span class="mx-auto mt-sm h-(--spacing-xs) w-(--size-grabber) shrink-0 rounded-pill bg-ink-ghost" aria-hidden="true" />
        <header class="grid h-(--size-row) shrink-0 grid-cols-[1fr_auto_1fr] items-center px-ml">
          <button
            type="button"
            class="-ml-sm min-h-(--size-touch) justify-self-start px-sm text-body text-ink-muted"
            :data-testid="`${testid}.cancel`"
            @click="close"
          >
            {{ t('common.cancel') }}
          </button>
          <h2 :id="titleId" class="truncate text-body font-semibold">{{ title }}</h2>
          <button
            v-if="action"
            type="button"
            :disabled="actionDisabled"
            class="-mr-sm min-h-(--size-touch) justify-self-end px-sm text-body font-semibold text-accent disabled:text-ink-ghost"
            :data-testid="`${testid}.action`"
            @click="emit('action')"
          >
            {{ action }}
          </button>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto px-ml pb-sm">
          <slot />
        </div>
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sheet {
  max-height: calc(100dvh - env(safe-area-inset-top) - var(--spacing-xl));
  transition: transform var(--duration-sheet) var(--ease-sheet);
}

.sheet-enter-active {
  transition: transform var(--duration-sheet) var(--ease-sheet);
}
.sheet-leave-active {
  transition: transform var(--duration-sheet-exit) var(--ease-exit);
}
.sheet-enter-from,
.sheet-leave-to {
  transform: translateY(100%);
}

.scrim-enter-active {
  transition: opacity var(--duration-sheet) var(--ease-standard);
}
.scrim-leave-active {
  transition: opacity var(--duration-sheet-exit) var(--ease-exit);
}
.scrim-enter-from,
.scrim-leave-to {
  opacity: 0;
}
</style>
