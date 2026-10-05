/**
 * Home's header: the date eyebrow and the greeting for the time of day
 * ("Good evening", or "Good evening, Fabian" once she gave a name in the
 * Profile, issue #78). `now` refreshes when the app comes back to the front, so a
 * PWA left open overnight does not greet the morning with yesterday's evening.
 */
export type DayPart = 'morning' | 'afternoon' | 'evening'

/** Morning from 5, afternoon from 12, evening from 18 until 5 the next day. */
export function dayPartOf(date: Date): DayPart {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  return 'evening'
}

export function useGreeting() {
  const { t } = useI18n()
  const now = useState('greeting.now', () => new Date())

  if (import.meta.client) {
    const refresh = () => (now.value = new Date())
    onMounted(() => {
      document.addEventListener('visibilitychange', refresh)
      window.addEventListener('focus', refresh)
    })
    onUnmounted(() => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    })
  }

  // Auto-imported (no import line), so the data-layer tests can load dayPartOf in plain Node.
  const session = useSessionStore()
  const greeting = computed(() => {
    const part = dayPartOf(now.value)
    const name = session.member?.name
    return name ? t(`home.greeting.${part}Named`, { name }) : t(`home.greeting.${part}`)
  })
  return { now, greeting }
}
