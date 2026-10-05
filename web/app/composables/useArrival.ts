import { durationToken } from '~/utils/motion'

/**
 * Whether what a component shows has just come in after its loading
 * placeholders (the Profile and a year in review while the reading record
 * loads, docs/MOTION.md, Loading): true from the moment `loading` turns off
 * until the arrival has had its `standard` to play, so the content that takes
 * the placeholders' place carries `arrive` (fades in, rises into place) once,
 * and content that was there from the start, or comes later (another year
 * picked), simply shows.
 */
export function useArrival(loading: () => boolean) {
  const arriving = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(loading, (now, before) => {
    if (!before || now) return
    arriving.value = true
    clearTimeout(timer)
    // A frame or two beyond the motion itself, so the class never cuts it short.
    timer = setTimeout(() => (arriving.value = false), durationToken('standard') + 100)
  })
  onBeforeUnmount(() => clearTimeout(timer))
  return arriving
}
