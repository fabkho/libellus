// Press feedback on iPhone: Safari on iOS only applies `:active` (a button's
// press scale, a row's fill — docs/MOTION.md, Press) when a touch listener sits
// on the element or one of its ancestors. One passive listener on the document
// that does nothing is enough, and costs no scrolling performance.
export default defineNuxtPlugin(() => {
  document.addEventListener('touchstart', () => {}, { passive: true })
})
