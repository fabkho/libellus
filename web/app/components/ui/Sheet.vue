<script setup lang="ts">
// A bottom sheet the iOS way: it rises over a scrim with a grabber and a title
// row — a text Cancel at the top left (never a round ✕), the title in the
// middle, the sheet's one action at the right in the lamp colour. Closed by
// Cancel, a tap on the scrim, Escape, or swiping it down. Respects the home
// indicator. `testid` names the sheet; Cancel and the action get
// `<testid>.cancel` and `<testid>.action`.
//
// While it is open the rest of the app is out of reach (`inert`), the page
// does not scroll under it, and focus is inside it — on the panel, or on the
// field marked `data-autofocus`, focused in the tap that opened the sheet so
// iOS raises the keyboard with it. Closing gives focus back to what opened it
// (composables/useModalLayer.ts). With the keyboard up the sheet rides on it
// and the focused field scrolls into view (composables/useKeyboardInset.ts).
import { revealDelta, sheetLift } from '~/utils/keyboard'

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

const { handlers, offset, dragging } = useSwipeDown(close)

const scrim = useTemplateRef<HTMLElement>('scrim')
const panel = useTemplateRef<HTMLElement>('panel')
const body = useTemplateRef<HTMLElement>('body')
const { afterLeave } = useModalLayer(open, {
  elements: () => [scrim.value, panel.value],
  initialFocus: () => panel.value?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.value,
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}
watch(open, (isOpen) => {
  if (!import.meta.client) return
  if (isOpen) {
    scrolled.value = false
    window.addEventListener('keydown', onKeydown)
  } else {
    followsKeyboard.value = false
    window.removeEventListener('keydown', onKeydown)
  }
})
onUnmounted(() => import.meta.client && window.removeEventListener('keydown', onKeydown))

// ------------------------------------------------------------- the keyboard

const { inset: keyboard, room } = useKeyboardViewport(() => open.value)
/** How far the sheet sits up to clear the keyboard (its home-indicator padding may go behind it). */
const lift = computed(() => {
  if (!keyboard.value || !panel.value) return 0
  return sheetLift(keyboard.value, Number.parseFloat(getComputedStyle(panel.value).paddingBottom) || 0)
})
/** Which curve the panel's own movement is on: the keyboard's while it follows it, the sheet's after a drag. */
const followsKeyboard = ref(false)
watch(lift, () => (followsKeyboard.value = open.value))
watch(dragging, (now) => now && (followsKeyboard.value = false))

/** Scrolls the sheet's body (and only it) so the focused field shows whole above the keyboard. */
function revealFocused() {
  const scroller = body.value
  const field = document.activeElement
  if (!scroller || !(field instanceof HTMLElement) || !scroller.contains(field)) return
  const margin = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--spacing-md')) || 0
  const delta = revealDelta(scroller.getBoundingClientRect(), field.getBoundingClientRect(), margin)
  if (delta) scroller.scrollTop += delta
}
watch(lift, async () => {
  await nextTick()
  revealFocused()
})
function onFocusin() {
  if (lift.value) revealFocused()
}

const panelStyle = computed(() => {
  const y = offset.value - lift.value
  return {
    transform: y ? `translateY(${y}px)` : undefined,
    transition: dragging.value ? 'none' : undefined,
    '--sheet-lift': `${lift.value}px`,
    '--sheet-room': room.value === null ? undefined : `${room.value}px`,
  }
})

// --------------------------------------------------------- scrolled content

/** The body is scrolled: a hairline under the header keeps the rows from running into it. */
const scrolled = ref(false)
function onScroll() {
  scrolled.value = (body.value?.scrollTop ?? 0) > 0
}

const titleId = useId()

// ------------------------------------------------------------------ motion

/**
 * The panel is still rising (or sliding away): it carries `data-moving` until
 * its transition has ended, so whatever has to wait for the sheet to be in
 * place (the Playwright flows tapping a star) can wait for that rather than
 * guess from where it happens to be.
 */
const moving = ref(false)
function onAfterLeave() {
  moving.value = false
  afterLeave()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="scrim">
      <div v-if="open" ref="scrim" class="fixed inset-0 z-40 touch-none bg-scrim" :data-testid="`${testid}.scrim`" @click="close" />
    </Transition>
    <Transition
      name="sheet"
      @before-enter="moving = true"
      @after-enter="moving = false"
      @enter-cancelled="moving = false"
      @before-leave="moving = true"
      @after-leave="onAfterLeave"
      @leave-cancelled="moving = false"
    >
      <section
        v-if="open"
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        class="sheet safe-bottom fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-(--size-max-content) flex-col rounded-t-sheet bg-surface-sheet shadow-sheet outline-none"
        :class="followsKeyboard && 'follows-keyboard'"
        :style="panelStyle"
        :data-testid="testid"
        :data-moving="moving || undefined"
        v-on="handlers"
        @focusin="onFocusin"
      >
        <span class="mx-auto mt-sm h-(--spacing-xs) w-(--size-grabber) shrink-0 touch-none rounded-pill bg-ink-ghost" aria-hidden="true" />
        <!-- Both sides are as wide as the wider of Cancel and the action (each
             holds an invisible copy of the other), so the title stays centred
             and a long one truncates instead of pushing Cancel aside. -->
        <header
          class="relative grid h-(--size-row) shrink-0 touch-none grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)] items-center gap-sm px-ml"
        >
          <div class="grid justify-items-start">
            <button
              type="button"
              class="col-start-1 row-start-1 -ml-sm min-h-(--size-touch) px-sm text-body text-ink-muted hover:text-ink"
              :data-testid="`${testid}.cancel`"
              @click="close"
            >
              {{ t('common.cancel') }}
            </button>
            <span v-if="action" class="invisible col-start-1 row-start-1 -ml-sm px-sm text-body font-semibold" aria-hidden="true">{{ action }}</span>
          </div>
          <h2 :id="titleId" class="min-w-0 truncate text-center text-body font-semibold" :data-testid="`${testid}.sheetTitle`">{{ title }}</h2>
          <div class="grid justify-items-end">
            <button
              v-if="action"
              type="button"
              :disabled="actionDisabled"
              class="col-start-1 row-start-1 -mr-sm min-h-(--size-touch) px-sm text-body font-semibold text-accent disabled:text-ink-ghost"
              :data-testid="`${testid}.action`"
              @click="emit('action')"
            >
              {{ action }}
            </button>
            <span class="invisible col-start-1 row-start-1 -mr-sm px-sm text-body" aria-hidden="true">{{ t('common.cancel') }}</span>
          </div>
          <span class="rule pointer-events-none absolute inset-x-0 bottom-0 h-(--stroke-hairline) bg-hairline-strong" :class="scrolled && 'on'" aria-hidden="true" />
        </header>
        <div ref="body" class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-ml pb-sm" @scroll.passive="onScroll">
          <slot />
        </div>
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sheet {
  /* Never under the status bar; with the keyboard up, never above the screen's
     top either: no taller than what the keyboard leaves in view (`--sheet-room`),
     even where Safari has panned down to the focused field and the lift reads 0. */
  max-height: min(
    calc(100dvh - env(safe-area-inset-top) - var(--spacing-xl) - var(--sheet-lift, 0px)),
    calc(var(--sheet-room, 100dvh) - env(safe-area-inset-top) - var(--spacing-xl))
  );
  transition: transform var(--duration-sheet) var(--ease-sheet);
}

/* Riding up and down with the iOS keyboard, on its curve (as the search palette does). */
.sheet.follows-keyboard {
  transition: transform var(--duration-keyboard) var(--ease-keyboard);
}

.sheet-enter-active {
  transition: transform var(--duration-sheet) var(--ease-sheet);
}
.sheet.sheet-leave-active {
  transition: transform var(--duration-sheet-exit) var(--ease-exit);
}
.sheet-enter-from,
.sheet-leave-to {
  transform: translateY(100%);
}

/* The header's hairline shows once the body has scrolled under it. */
.rule {
  opacity: 0;
  transition: opacity var(--duration-quick) var(--ease-standard);
}
.rule.on {
  opacity: 1;
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
