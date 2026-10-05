/**
 * Whether writes can reach the database: one value for the whole app. Every
 * action that writes is disabled and labelled "Offline" while it is false
 * (issue #15), search answers from the member's own Library, and the Library
 * shows what this device last saw instead of asking. Two things make it false:
 *
 *   - the browser says there is no network at all (`navigator.onLine` and its
 *     `online` / `offline` events);
 *   - a connection that answers nothing (issue #105): a write timed out or failed
 *     with a network error (`reportNoAnswer`, from the client's fetch,
 *     data/network.ts). The write is not lost — it waits in the outbox — and the
 *     device counts as offline for writes until the backend answers again: a
 *     reachability probe (`registerProbe`) asks after a pause that doubles with
 *     every write that got no answer, and a write that is answered
 *     (`reportAnswer`) ends it at once.
 */
const browserOnline = ref(true)
const answers = ref(true)
const online = computed(() => browserOnline.value && answers.value)

/** The first pause before the probe asks again, and the longest. */
const FIRST_PAUSE_MS = 2_000
const LONGEST_PAUSE_MS = 30_000

let listening = false
let probe: (() => Promise<boolean>) | null = null
let failures = 0
let timer: ReturnType<typeof setTimeout> | undefined

/** The pause before the probe asks again after `failures` writes that got no answer. */
export function probePause(count: number): number {
  return Math.min(FIRST_PAUSE_MS * 2 ** Math.max(count - 1, 0), LONGEST_PAUSE_MS)
}

async function recheck() {
  timer = undefined
  if (answers.value) return
  const ok = probe ? await probe().catch(() => false) : true
  if (ok) answers.value = true
  else if (!answers.value) timer = setTimeout(() => void recheck(), probePause(failures))
}

function listen() {
  if (listening || !import.meta.client) return
  listening = true
  browserOnline.value = navigator.onLine
  window.addEventListener('online', () => {
    browserOnline.value = true
    // The network is back: ask the backend now rather than after the pause.
    if (!answers.value) {
      clearTimeout(timer)
      void recheck()
    }
  })
  window.addEventListener('offline', () => (browserOnline.value = false))
}

/** The question "does anything answer?" the composable asks while it waits for the backend (data/network.ts, createProbe). */
export function registerProbe(ask: () => Promise<boolean>) {
  probe = ask
}

/** The same question, for the outbox: true when nothing is registered. */
export function askBackend(): Promise<boolean> {
  return probe ? probe().catch(() => false) : Promise.resolve(true)
}

/** A write got no answer (it timed out, or the network failed): writes count as offline until the backend answers. */
export function reportNoAnswer() {
  failures += 1
  if (!answers.value) return
  answers.value = false
  clearTimeout(timer)
  timer = setTimeout(() => void recheck(), probePause(failures))
}

/** A write was answered, whatever the answer: the connection works. */
export function reportAnswer() {
  failures = 0
  if (answers.value) return
  clearTimeout(timer)
  timer = undefined
  answers.value = true
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
