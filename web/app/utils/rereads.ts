/**
 * What to read again once the app is back online. A write whose request was sent and got no answer
 * (`offline` while the app still thought it was online, data/network.ts) may have been applied by the
 * server all the same: the screen still shows the old state, so the reads it touches are asked once
 * more when the connection answers. A write refused before anything was sent (already offline) needs
 * none. Framework-free, so the rule is tested without a store.
 */
export function createRereads<T extends string>() {
  const waiting = new Set<T>()
  return {
    /** A write answered `error`; `sent`: the app counted itself online when it went out. */
    note(sent: boolean, error: string | null, targets: readonly T[]) {
      if (sent && error === 'offline') for (const target of targets) waiting.add(target)
    },
    /** What is waiting, once: the next call starts empty. */
    take(): T[] {
      const all = [...waiting]
      waiting.clear()
      return all
    },
    clear() {
      waiting.clear()
    },
  }
}
