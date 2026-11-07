<script setup lang="ts">
// The three-way control of a note's audience, Only me · Friends · Everyone (docs/plans/book-notes.md part 2.3, 5; docs/parity.md, *Notes, visibility*): the
// base's icon segments (the reader's Margins style: the chosen segment unfolds its name beside the icon, the others are icons) as one radiogroup
// of 44 px segments, a lock, two people and a globe. The base's `UiIconSegments` can only switch the whole group off, and a reply may not be wider than
// the note it answers, so each level that is held back is `aria-disabled` here (and says why in `hint`, drawn by the screen). Without the owner's switch
// for Everyone (`publicEnabled` false) the group has two segments. One tab stop (the chosen one), the arrows move the choice and the focus, skipping what is held back.
import type { IconName } from '#layers/ui/app/components/ui/Icon.vue'
import { levelStates, type NoteLevel } from '~/utils/noteVisibility'

const props = withDefaults(defineProps<{ publicEnabled: boolean; parent?: NoteLevel | null; testid?: string; label?: string; labelledby?: string }>(), { parent: null, testid: 'notes.level', label: undefined, labelledby: undefined })
const model = defineModel<NoteLevel>({ required: true })

const { t } = useI18n()
const ICONS: Record<NoteLevel, IconName> = { private: 'lock', friends: 'people', public: 'globe' }
const states = computed(() => levelStates(props.publicEnabled, props.parent))
const buttons = useTemplateRef<HTMLButtonElement[]>('buttons')
const stop = computed(() => Math.max(0, states.value.findIndex((s) => s.level === model.value)))

function choose(level: NoteLevel) {
  if (states.value.find((s) => s.level === level)?.disabled) return
  model.value = level
}

function onKeydown(event: KeyboardEvent) {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
  if (!step) return
  event.preventDefault()
  const all = states.value
  for (let k = 1; k <= all.length; k++) {
    const next = (stop.value + step * k + all.length * k) % all.length
    if (all[next]!.disabled) continue
    model.value = all[next]!.level
    buttons.value?.[next]?.focus()
    return
  }
}

</script>

<template>
  <div
    role="radiogroup"
    :aria-labelledby="labelledby"
    :aria-label="labelledby ? undefined : (label ?? t('notes.level.label'))"
    class="flex h-(--size-row) min-w-0 rounded-md bg-fill p-xxs edge-faint"
    :data-testid="testid"
    @keydown="onKeydown"
  >
    <button
      v-for="(s, i) in states"
      :key="s.level"
      ref="buttons"
      type="button"
      role="radio"
      :aria-checked="model === s.level"
      :aria-disabled="s.disabled || undefined"
      :aria-label="t(`notes.level.${s.level}`)"
      :tabindex="i === stop ? 0 : -1"
      class="segment flex min-w-0 items-center justify-center text-caption"
      :class="[model === s.level ? 'on text-ink' : 'text-ink-muted', s.disabled && 'opacity-40']"
      :data-testid="`${testid}.${s.level}`"
      @click="choose(s.level)"
    >
      <UiIcon :name="ICONS[s.level]" :size="20" />
      <span class="name grid" aria-hidden="true">
        <span class="min-w-0 overflow-hidden whitespace-nowrap"><span class="gap">{{ t(`notes.level.${s.level}`) }}</span></span>
      </span>
    </button>
  </div>
</template>

<style scoped>
/* The base's icon segments, drawn the same: the chosen segment grows and its name unfolds beside the icon. */
.segment {
  flex: 1 1 0;
  border-radius: calc(var(--radius-md) - var(--spacing-xxs));
  background: transparent;
  transition:
    flex-grow var(--duration-standard) var(--ease-standard),
    background-color var(--duration-standard) var(--ease-standard),
    box-shadow var(--duration-standard) var(--ease-standard),
    color var(--duration-quick) var(--ease-standard);
}
.segment.on {
  flex-grow: 2.3;
  background: var(--color-surface-raised);
  box-shadow:
    0 0 0 var(--stroke-hairline) var(--color-hairline),
    0 var(--stroke-rule) var(--spacing-xxs) color-mix(in srgb, var(--color-ink) 12%, transparent);
}
.segment:focus-visible {
  outline: var(--stroke-focus) solid var(--color-accent);
  outline-offset: calc(-1 * var(--stroke-focus));
}
.name {
  grid-template-columns: 0fr;
  opacity: 0;
  transition:
    grid-template-columns var(--duration-standard) var(--ease-standard),
    opacity var(--duration-standard) var(--ease-standard);
}
.gap {
  display: block;
  padding-left: var(--spacing-xs);
}
.segment.on .name {
  grid-template-columns: 1fr;
  opacity: 1;
}
</style>
