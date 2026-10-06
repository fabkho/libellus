import type { ProfileSheet } from '~/stores/stats'

/**
 * The sheet of a month's books or a star row's, on the Profile or a year in
 * review (issue #78). Any change of page closes a sheet (components/ui/Sheet.vue);
 * this one comes back, as it was left, when the member returns from a Book
 * opened from it (composables/useSheetRestore.ts).
 *
 * `sheet` is what is open (null: none); `shown` keeps the last one while the
 * sheet slides away, so its content does not empty out under it. `restore` is
 * for the sheet's `restore`.
 */
export function useProfileSheet() {
  const sheet = ref<ProfileSheet | null>(null)
  const shown = ref<ProfileSheet | null>(null)
  watch(sheet, (now) => now && (shown.value = now))
  const open = computed({
    get: () => sheet.value !== null,
    set: (isOpen: boolean) => !isOpen && (sheet.value = null),
  })

  const { restore } = useSheetRestore({
    testid: 'profileReads',
    sheet: () => sheet.value,
    reopen: (kept) => (sheet.value = kept),
  })

  return { sheet, shown, open, restore }
}
