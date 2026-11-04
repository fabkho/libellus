/**
 * A pushed screen takes the focus when it opens: its heading (the page's one `h1`), once it is drawn. Entering a screen with Enter on a row
 * leaves the focus on `<body>` (the row that had it is gone with the page it was on), so the next Tab starts from the top and a screen reader
 * says nothing of where it is; WCAG 2.4.3 wants the focus to go somewhere that makes sense. The heading is not a control, so it is made
 * focusable by script only (`tabindex="-1"`: no tab stop) and draws no ring. Nothing is stolen: it only moves focus that is on `<body>`
 * (the thread's composer or a sheet she opened already keeps it), and never scrolls. Once per screen.
 *
 * `ready`: the screen has its heading (a getter, so it may turn true after the first look); a screen whose heading is there from the start
 * passes `() => true`.
 */
export function useFocusHeading(ready: () => boolean) {
  let done = false
  async function focus() {
    if (done || !ready()) return
    await nextTick()
    const heading = document.querySelector<HTMLElement>('h1')
    if (!heading) return
    done = true
    const active = document.activeElement
    if (active && active !== document.body) return
    heading.setAttribute('tabindex', '-1')
    heading.style.outline = 'none'
    heading.focus({ preventScroll: true })
  }
  onMounted(focus)
  watch(ready, focus, { flush: 'post' })
}
