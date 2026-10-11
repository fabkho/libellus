/**
 * Where a pushed page's back button goes (the app's one rule, see People): back through the history when the
 * page was reached from another page of the app, so that page is shown again as it was left (the Profile, Home,
 * a member's page …, scroll kept by the router's cache); only a page opened directly (a link, a reload, a new
 * tab: nothing before it in this app's history) goes to its fallback. A fixed place, or only one earlier page
 * as the way back, sends her somewhere she did not come from.
 *
 * `state` is `window.history.state`: vue-router writes the address before it as `back`.
 */
export function canGoBack(state: { back?: unknown } | null | undefined): boolean {
  return typeof state?.back === 'string' && state.back.length > 0
}
