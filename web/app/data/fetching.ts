/**
 * What the search sources share about talking to the outside world: the slice
 * of `fetch` they use (injected, so the tests answer from recordings), and how
 * a query replaced by a newer one ends. Framework-free.
 */

/** The slice of `fetch` the repositories use; the browser's and Node's both fit. */
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

export function abortError(): Error {
  const error = new Error('The search was replaced by a newer one')
  error.name = 'AbortError'
  return error
}

/** True for the rejection a superseded query ends in. */
export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** GETs JSON; rejects on anything but a 2xx answer. */
export async function getJson(fetch: FetchLike, url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}`)
  return response.json()
}
