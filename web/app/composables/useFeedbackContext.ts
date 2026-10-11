import { buildContext, type FeedbackContext } from '~/data/feedback'

function standalone(): boolean | null {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  } catch {
    return null
  }
}

/**
 * What the app attaches to a message from Contact (data/feedback.ts, `buildContext`): read off the device
 * when she sends, not before. The route goes in as the router's pattern (`/r/[token]`), never as the address.
 */
export function useFeedbackContext(): () => FeedbackContext {
  const route = useRoute()
  const { locale } = useI18n()
  const config = useRuntimeConfig()
  return () =>
    buildContext({
      appVersion: String(config.app.buildId ?? '') || null,
      path: route.path,
      pattern: route.matched.at(-1)?.path ?? null,
      standalone: standalone(),
      platform: (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? null,
      userAgent: navigator.userAgent,
      locale: locale.value,
      online: isOnline(),
      screen: { width: window.screen.width, height: window.screen.height, ratio: window.devicePixelRatio || 1 },
    })
}
