/**
 * Home's header: the date eyebrow and the greeting for the time of day
 * ("Good evening"). `now` refreshes when the app comes back to the front, so a
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

  const greeting = computed(() => t(`home.greeting.${dayPartOf(now.value)}`))
  return { now, greeting }
}
