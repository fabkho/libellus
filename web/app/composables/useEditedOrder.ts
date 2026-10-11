import type { Ref } from 'vue'
import { heldOrder } from '~/utils/editedOrder'

/**
 * Collections as a screen shows them: last edited first (the list the store keeps), but held still while
 * she looks (`heldOrder`, utils/editedOrder.ts). The order is taken when the screen is entered: mounted
 * or shown again (`onActivated`), and for a sheet when `entered` turns true (the picker opening); once
 * more when the list first has something, so a list that was still on its way when she arrived is
 * sorted too.
 *
 * `settle`: the screen's list also holds still while a sheet is on screen over it and while it is in the
 * background (`useSettled`), then changes in view of her. A sheet's own list does not (it is on screen
 * itself: it must show what arrives).
 */
export function useEditedOrder<T extends { id: string }>(
  source: () => readonly T[],
  { arrival, settle = false, entered }: { arrival: 'first' | 'last'; settle?: boolean; entered?: () => boolean },
): Readonly<Ref<T[]>> {
  const shown = settle ? useSettled(source) : computed(source)
  const held = ref<string[]>([])
  const take = () => {
    held.value = source().map((item) => item.id)
  }

  onMounted(take)
  onActivated(take)
  if (entered) watch(entered, (now) => now && take())
  // The list was empty on entering (still loading): take it as soon as there is one.
  watch(
    () => source().length > 0 && held.value.length === 0,
    (late) => late && take(),
  )

  return computed(() => heldOrder(held.value, shown.value, arrival))
}
