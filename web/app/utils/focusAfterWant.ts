/**
 * After Want to read added a Book the button is gone, and focus with it (social v2a, design review 4): this puts it
 * back on the row's heart when there is one, else on the Book's title link. `row` is the row's element, the test
 * ids are the heart's and the title's (the rows' own).
 */
export function focusAfterWant(row: HTMLElement | null | undefined, heartTestid: string, titleTestid: string): void {
  const find = (testid: string) => row?.querySelector<HTMLElement>(`[data-testid="${testid}"]`) ?? null
  const target = find(heartTestid) ?? find(titleTestid)
  target?.focus()
}
