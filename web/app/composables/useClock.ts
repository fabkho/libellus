/** The time now (ms), updated every second while the screen is mounted: what a countdown reads. */
export function useClock() {
  const now = ref(Date.now())
  let ticker: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    now.value = Date.now()
    ticker = setInterval(() => (now.value = Date.now()), 1_000)
  })
  onUnmounted(() => clearInterval(ticker))
  return now
}
