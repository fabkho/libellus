/** The direction's toggles, typed: theme (light / dark) and the shelf view. */
import { computed } from 'vue'
import { useProto } from '../../../contract'
import type { Palette } from './paint'

export type ShelfView = 'spines' | 'stacks' | 'covers'

export function useShelf() {
  const proto = useProto()
  const dark = computed(() => proto.value.toggles.theme === 'dark')
  return {
    proto,
    dark,
    /** Spine and wash maths: light paper → 'wood', dark room → 'ink'. */
    palette: computed<Palette>(() => (dark.value ? 'ink' : 'wood')),
    view: computed(() => (proto.value.toggles.view ?? 'spines') as ShelfView),
    data: computed(() => proto.value.data),
  }
}
