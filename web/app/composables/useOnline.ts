/**
 * Whether the device has a connection, as the browser says (`navigator.onLine`
 * and its `online` / `offline` events). One value for the whole app: every
 * action that writes is disabled and labelled "Offline" while it is false
 * (issue #15), search answers from the member's own Library, and the Library
 * shows what this device last saw instead of asking.
 *
 * The browser can only tell that there is no network at all; a network that
 * answers nothing still counts as online, and then the write fails with its
 * error like any other failed call.
 */
const online = ref(true)
let listening = false

function listen() {
  if (listening || !import.meta.client) return
  listening = true
  online.value = navigator.onLine
  window.addEventListener('online', () => (online.value = true))
  window.addEventListener('offline', () => (online.value = false))
}

export function useOnline(): Readonly<Ref<boolean>> {
  listen()
  return readonly(online)
}

/** The same answer outside a component (stores, plain functions): read when asked. */
export function isOnline(): boolean {
  listen()
  return online.value
}
