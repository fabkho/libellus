<script setup lang="ts">
// A confirmation for something that cannot be taken back (deleting a read,
// removing a Book from the Library). It rises over a scrim above everything,
// sheets included: the question in the serif, what is lost beneath it, the
// destructive action and Cancel. Closed by Cancel, a tap on the scrim, Escape
// or the system Back — never while the action runs. A refusal stays in the dialog with its
// reason and the same button tries again. `testid` names the dialog; the
// action and Cancel get `<testid>.confirm` and `<testid>.cancel`, a refusal
// `<testid>.error`. `offline` (#15): the action stays, disabled, and says
// "Offline" (UiButton); Cancel still closes it. `alternative`: a safe way out
// offered above the destructive action (Sign out with changes waiting to sync:
// "Sync first", #93), `<testid>.alternative`.
const open = defineModel<boolean>('open', { required: true })

const props = withDefaults(
  defineProps<{
    title: string
    text?: string
    action: string
    busy?: boolean
    error?: string | null
    offline?: boolean
    alternative?: string
    testid: string
  }>(),
  { text: undefined, busy: false, error: null, offline: false, alternative: undefined },
)
const emit = defineEmits<{ confirm: []; alternative: [] }>()

const { t } = useI18n()

function close() {
  if (!props.busy) open.value = false
}

const scrim = useTemplateRef<HTMLElement>('scrim')
const panel = useTemplateRef<HTMLElement>('panel')
// Above everything, a sheet under it included: the rest is out of reach while
// it asks, and focus goes back to what asked once it closes (useModalLayer).
// Back closes it as Cancel does (never while the action runs).
const { afterLeave } = useModalLayer(open, { elements: () => [scrim.value, panel.value], initialFocus: () => panel.value, close })

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  // Only the dialog closes: a sheet under it keeps its own Escape for later.
  event.stopImmediatePropagation()
  close()
}
watch(open, (isOpen) => {
  if (!import.meta.client) return
  if (isOpen) window.addEventListener('keydown', onKeydown, true)
  else window.removeEventListener('keydown', onKeydown, true)
})
onUnmounted(() => import.meta.client && window.removeEventListener('keydown', onKeydown, true))

const titleId = useId()
const textId = useId()
</script>

<template>
  <Teleport to="body">
    <Transition name="scrim">
      <div v-if="open" ref="scrim" class="fixed inset-0 z-60 touch-none bg-scrim" :data-testid="`${testid}.scrim`" @click="close" />
    </Transition>
    <Transition name="dialog" @after-leave="afterLeave">
      <section
        v-if="open"
        ref="panel"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="text ? textId : undefined"
        tabindex="-1"
        class="dialog safe-bottom fixed inset-x-0 bottom-0 z-70 mx-auto w-full max-w-(--size-max-content) px-ml outline-none"
        :data-testid="testid"
      >
        <div class="mb-sm rounded-xl bg-surface-sheet px-ml pt-ml pb-ml shadow-sheet edge">
          <h2 :id="titleId" class="book-title text-headline text-balance" :data-testid="`${testid}.title`">{{ title }}</h2>
          <p v-if="text" :id="textId" class="mt-sm text-subhead text-ink-muted" :data-testid="`${testid}.text`">{{ text }}</p>
          <p v-if="error" class="mt-ms text-caption text-error" role="alert" :data-testid="`${testid}.error`">{{ error }}</p>
          <div class="mt-lg flex flex-col gap-sm">
            <UiButton
              v-if="alternative"
              block
              :disabled="busy"
              :aria-busy="busy"
              :data-testid="`${testid}.alternative`"
              @click="emit('alternative')"
            >
              {{ alternative }}
            </UiButton>
            <UiButton
              block
              tone="danger"
              :disabled="busy"
              :offline="offline"
              :aria-busy="busy"
              :data-testid="`${testid}.confirm`"
              @click="emit('confirm')"
            >
              {{ action }}
            </UiButton>
            <UiButton block tone="quiet" :disabled="busy" :data-testid="`${testid}.cancel`" @click="close">
              {{ t('common.cancel') }}
            </UiButton>
          </div>
        </div>
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-enter-active {
  transition: transform var(--duration-sheet) var(--ease-sheet);
}
.dialog-leave-active {
  transition: transform var(--duration-sheet-exit) var(--ease-exit);
}
.dialog-enter-from,
.dialog-leave-to {
  transform: translateY(calc(100% + var(--spacing-xl)));
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
