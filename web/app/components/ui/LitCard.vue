<script setup lang="ts">
// A raised, rounded panel lit by a Book's own cover (the "Lit feature" card of Home's Your circle, the Profile's year
// cards and Your reviews): `UiAmbient` in the cover's colours, and a Book on the Placeholder lit by its cloth, as the
// book page's hero is. It is the panel only: the layout inside is the slot's (and the classes on it: padding, flex,
// width). The cover tells whether it is the Placeholder through the slot's `onFallback` (`<UiCover @fallback=…>`).
// Props: `colors` (the cover's), `title` (the Book's: it picks the cloth).
import type { CoverColors } from '~/utils/cover'

const props = defineProps<{ colors: CoverColors | null; title: string }>()

const placeholder = ref(false)
const cloth = computed(() => (placeholder.value ? `var(--color-cloth${clothOf(props.title)})` : null))
</script>

<template>
  <div class="relative overflow-hidden rounded-lg bg-surface-raised shadow-raised edge-faint">
    <UiAmbient :colors="colors" :cloth="cloth" shape="card" />
    <slot :on-fallback="(now: boolean) => (placeholder = now)" />
  </div>
</template>
