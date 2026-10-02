<script setup lang="ts">
import { computed } from 'vue'
import type { Direction, ScreenKey } from '../contract'
import { provideProto } from '../contract'
import NotBuilt from './NotBuilt.vue'
import StatusBar from './StatusBar.vue'

/**
 * One iPhone 15/16-sized window (393 × 852 points) with the device chrome, and
 * the single place a direction enters the tree:
 *
 * - `data-direction="<key>"` and one `data-<toggle>="<value>"` per toggle on the
 *   screen element, so a direction's CSS scopes itself with
 *   `[data-direction='a'][data-palette='dusk'] { … }`;
 * - `useProto()` for the screen and everything under it (direction, screen key,
 *   toggles, sample data), provided per frame, so the Vergleich view can show
 *   one screen in every direction on one page.
 *
 * The screen element carries `--safe-top` / `--safe-bottom` (the notch and the
 * home indicator; `env()` is 0 on a desktop) and is the containing block for
 * `position: fixed`, so a tab bar or sheet can pin itself to the phone.
 */
const props = defineProps<{
  direction: Direction
  screen: ScreenKey
  toggles: Record<string, string>
  /** Above the frame, e.g. "Search". */
  label?: string
  /** The state, next to the label, e.g. "typing". */
  caption?: string
  /** Screenshot handle, see scripts/proto-shots.mjs. */
  shot?: string
}>()

provideProto(() => ({ direction: props.direction, screen: props.screen, toggles: props.toggles }))

const component = computed(() => props.direction.screens[props.screen])

const toggleAttrs = computed(() =>
  Object.fromEntries(Object.entries(props.toggles).map(([key, value]) => [`data-${key}`, value])),
)
</script>

<template>
  <figure class="frame">
    <figcaption v-if="label" class="caption">
      <span class="label">{{ label }}</span>
      <span v-if="caption" class="state">{{ caption }}</span>
    </figcaption>

    <div class="bezel" :data-shot="shot">
      <div
        class="screen"
        :data-direction="direction.key"
        :data-screen="screen"
        :data-built="component ? undefined : 'false'"
        v-bind="toggleAttrs"
      >
        <div class="content">
          <component :is="component" v-if="component" />
          <NotBuilt v-else :screen="screen" />
        </div>

        <StatusBar />
        <div class="island" aria-hidden="true" />
        <div class="home-indicator" aria-hidden="true" />
      </div>
    </div>
  </figure>
</template>

<style scoped>
.frame {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  gap: 10px;
  margin: 0;
}

.caption {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-left: 12px;
  font: 13px/1.3 system-ui, sans-serif;
}

.label {
  font-weight: 600;
  color: #27272a;
}

.state {
  color: #71717a;
}

.bezel {
  padding: 10px;
  border-radius: 57px;
  background: #18181b;
  box-shadow: 0 18px 44px rgb(0 0 0 / 0.18);
}

.screen {
  /* Device geometry, for directions to read. */
  --frame-width: 393px;
  --frame-height: 852px;
  --safe-top: 59px;
  --safe-bottom: 34px;

  position: relative;
  width: 393px;
  height: 852px;
  overflow: hidden;
  border-radius: 47px;
  /* Containing block for position: fixed inside the screen. */
  transform: translateZ(0);
  isolation: isolate;
  background: var(--screen-background, #fff);
  color: #111;
  font: 17px/1.35 -apple-system, system-ui, sans-serif;
  text-align: left;
}

/* A missing screen ignores the direction's chrome colours. */
.screen[data-built='false'] {
  --status-bar-ink: #111;
  --home-indicator: rgb(0 0 0 / 0.3);
}

.content {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.island {
  position: absolute;
  top: 11px;
  left: 50%;
  z-index: 50;
  width: 124px;
  height: 36px;
  border-radius: 999px;
  background: #000;
  transform: translateX(-50%);
  pointer-events: none;
}

.home-indicator {
  position: absolute;
  bottom: 8px;
  left: 50%;
  z-index: 50;
  width: 140px;
  height: 5px;
  border-radius: 999px;
  background: var(--home-indicator, rgb(0 0 0 / 0.3));
  transform: translateX(-50%);
  pointer-events: none;
}
</style>
