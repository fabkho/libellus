// DESIGN ROUND (proto/format-pills), dev only: which look the format choice wears.
// `?formatUi=a|b|c` picks one; anything else is today's four pills. Only read behind
// `import.meta.dev` (components/book/FormatChoice.vue), so builds never carry it.
export type FormatUi = 'pills' | 'a' | 'b' | 'c'
const UIS: readonly FormatUi[] = ['pills', 'a', 'b', 'c']

export function useFormatUi() {
  const route = useRoute()
  const query = String(route.query.formatUi ?? '')
  const ui = useState<FormatUi>('formatUi', () => (UIS.includes(query as FormatUi) ? (query as FormatUi) : 'pills'))
  // `?formatUi=…` always wins when it is on the address; chips write it back without a navigation.
  if (UIS.includes(query as FormatUi) && ui.value !== query) ui.value = query as FormatUi
  const chips = computed(() => route.query.formatChips !== '0')
  function set(next: FormatUi) {
    ui.value = next
    const url = new URL(window.location.href)
    url.searchParams.set('formatUi', next)
    window.history.replaceState(window.history.state, '', url)
  }
  return { ui, chips, set, all: UIS }
}
