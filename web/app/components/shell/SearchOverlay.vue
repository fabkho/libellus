<script setup lang="ts">
// Search as an overlay, never a page (issue #1, Screens and navigation; D's
// DECISIONS.md). The tab bar's place is taken by D's upside-down command
// palette over whatever page is showing, which stays behind it, blurred and
// veiled. The bottom row keeps Home and Library at the left (the current tab
// stays lit) and the query takes the rest; while the query has the keyboard,
// Cancel replaces the tabs. Above the query is where results go: the default
// slot, best match at the bottom next to the query (#6, #12 fill it). Until
// then the slot shows a line saying search is coming.
//
// Closed by Cancel, a tap on the page behind, swiping the palette down, Escape,
// or going to another page. The morph from the capsule into the palette is
// #21; for now the palette rises and fades in (docs/MOTION.md).
import { useSearchStore } from '~/stores/search'

const { t } = useI18n()
const route = useRoute()
const search = useSearchStore()

const input = useTemplateRef<HTMLInputElement>('input')
const typing = ref(false)

const PAGES = [
  { key: 'home', to: '/', icon: 'home' },
  { key: 'library', to: '/library', icon: 'library' },
] as const

function close() {
  input.value?.blur()
  search.close()
}

const { handlers, dragStyle } = useSwipeDown(close)

// While the query has the keyboard the palette sits right above it. iOS lays
// the keyboard over the page instead of resizing it, so its height is read
// from the visual viewport.
const keyboard = ref(0)
function measureKeyboard() {
  const viewport = window.visualViewport
  keyboard.value = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0
}
const paletteStyle = computed(() => ({
  ...dragStyle.value,
  ...(keyboard.value > 0 ? { bottom: `calc(${keyboard.value}px + var(--spacing-sm))` } : {}),
}))

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

watch(
  () => search.isOpen,
  async (open) => {
    if (!import.meta.client) return
    if (open) {
      window.addEventListener('keydown', onKeydown)
      window.visualViewport?.addEventListener('resize', measureKeyboard)
      window.visualViewport?.addEventListener('scroll', measureKeyboard)
      // Opened from a tap, so the keyboard may come up with it.
      await nextTick()
      input.value?.focus({ preventScroll: true })
    } else {
      window.removeEventListener('keydown', onKeydown)
      window.visualViewport?.removeEventListener('resize', measureKeyboard)
      window.visualViewport?.removeEventListener('scroll', measureKeyboard)
      typing.value = false
      keyboard.value = 0
    }
  },
)
watch(() => route.path, () => search.isOpen && search.close())
onUnmounted(() => {
  if (!import.meta.client) return
  window.removeEventListener('keydown', onKeydown)
  window.visualViewport?.removeEventListener('resize', measureKeyboard)
  window.visualViewport?.removeEventListener('scroll', measureKeyboard)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="veil">
      <button
        v-if="search.isOpen"
        type="button"
        :aria-label="t('search.close')"
        class="veil fixed inset-0 z-30 bg-veil"
        data-testid="search.backdrop"
        @click="close"
      />
    </Transition>

    <Transition name="palette">
      <section
        v-if="search.isOpen"
        role="dialog"
        aria-modal="true"
        :aria-label="t('search.title')"
        class="palette float-bottom fixed inset-x-ms z-40 mx-auto flex max-w-(--size-max-content) flex-col overflow-hidden rounded-xl bg-surface-raised edge shadow-palette"
        :style="paletteStyle"
        data-testid="search.overlay"
        v-on="handlers"
      >
        <div class="flex flex-col justify-end">
          <slot>
            <p class="px-lg py-lg text-center text-caption text-ink-faint" data-testid="search.empty">
              {{ t('search.empty') }}
            </p>
          </slot>
        </div>

        <div class="h-(--stroke-hairline) shrink-0 bg-hairline" aria-hidden="true" />

        <div class="flex h-(--size-query) shrink-0 items-center gap-sm" :class="typing ? 'pr-inset pl-md' : 'pr-inset pl-sm'">
          <template v-if="!typing">
            <NuxtLink
              v-for="tab in PAGES"
              :key="tab.key"
              :to="tab.to"
              class="tab"
              :class="route.path === tab.to ? 'text-ink' : 'text-ink-faint'"
              :aria-current="route.path === tab.to ? 'page' : undefined"
              :data-testid="`search.tab.${tab.key}`"
            >
              <UiIcon :name="tab.icon" :bold="route.path === tab.to" />
              <span class="sr-only">{{ t(`tabs.${tab.key}`) }}</span>
              <span v-if="route.path === tab.to" class="dot" aria-hidden="true" />
            </NuxtLink>
            <span class="mr-xs h-lg w-(--stroke-hairline) shrink-0 bg-hairline-strong" aria-hidden="true" />
          </template>

          <UiIcon name="search" :size="19" class="text-accent" />
          <input
            ref="input"
            v-model="search.query"
            type="search"
            inputmode="search"
            enterkeyhint="search"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            :aria-label="t('search.title')"
            :placeholder="t('search.placeholder')"
            class="min-w-0 flex-1 bg-transparent text-callout text-ink caret-accent outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden"
            data-testid="search.query"
            @focus="typing = true"
            @blur="typing = false"
          />
          <button
            v-if="search.query"
            type="button"
            :aria-label="t('search.clear')"
            class="relative flex size-ml shrink-0 items-center justify-center rounded-pill bg-fill-strong text-ink-muted after:absolute after:-inset-ms after:content-['']"
            data-testid="search.clear"
            @pointerdown.prevent
            @click="search.query = ''"
          >
            <UiIcon name="close" :size="13" bold />
          </button>
          <span v-if="typing" class="ml-xs h-ml w-(--stroke-hairline) shrink-0 bg-hairline-strong" aria-hidden="true" />
          <button
            v-if="typing"
            type="button"
            class="min-h-(--size-touch) shrink-0 pl-xs text-body text-ink-muted"
            data-testid="search.cancel"
            @pointerdown.prevent
            @click="close"
          >
            {{ t('common.cancel') }}
          </button>
        </div>
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* The page stays put behind the palette, blurred and veiled. */
.veil {
  -webkit-backdrop-filter: blur(var(--blur-veil));
  backdrop-filter: blur(var(--blur-veil));
}

.tab {
  position: relative;
  display: flex;
  width: var(--size-touch);
  height: var(--size-touch);
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
}

.dot {
  position: absolute;
  bottom: var(--spacing-xxs);
  width: var(--spacing-xs);
  height: var(--spacing-xs);
  border-radius: var(--radius-pill);
  background: var(--color-accent);
}

.palette {
  touch-action: none;
  transition: transform var(--duration-overlay) var(--ease-sheet);
}

.veil-enter-active {
  transition: opacity var(--duration-overlay) var(--ease-standard);
}
.veil-leave-active {
  transition: opacity var(--duration-overlay-exit) var(--ease-exit);
}
.veil-enter-from,
.veil-leave-to {
  opacity: 0;
}

.palette-enter-active {
  transition:
    opacity var(--duration-overlay) var(--ease-standard),
    transform var(--duration-overlay) var(--ease-sheet);
}
.palette-leave-active {
  transition:
    opacity var(--duration-overlay-exit) var(--ease-exit),
    transform var(--duration-overlay-exit) var(--ease-exit);
}
.palette-enter-from,
.palette-leave-to {
  opacity: 0;
  transform: translateY(var(--spacing-lg)) scale(0.98);
}
</style>
