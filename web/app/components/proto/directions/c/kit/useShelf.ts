/** The direction's toggles, typed: palette, texture and the shelf view. */
import { computed } from 'vue'
import { useProto } from '../../../contract'
import type { Palette } from './paint'

export type ShelfView = 'spines' | 'stacks' | 'covers'

export function useShelf() {
  const proto = useProto()
  return {
    proto,
    palette: computed(() => (proto.value.toggles.palette ?? 'wood') as Palette),
    view: computed(() => (proto.value.toggles.view ?? 'spines') as ShelfView),
    data: computed(() => proto.value.data),
  }
}
