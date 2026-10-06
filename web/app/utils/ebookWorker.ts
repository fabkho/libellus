import { opfsFiles, type Ingested } from '../data/ebooks/files'

type Reply = { id: number; ok: true; result: Ingested } | { id: number; ok: false; error: { name: string; message: string; code?: string } }

/**
 * The ingest for one member's folder (`data/ebooks/ebooks.ts`, `Ingest`),
 * run in a worker (`data/ebooks/worker.ts`): reading a 20 MB EPUB and copying
 * it never holds up a frame. Started on the first file. Where a module worker
 * cannot start, the same code runs here on the main thread.
 */
export function workerIngest(dir: string): (file: Blob) => Promise<Ingested> {
  let worker: Worker | null | undefined
  let next = 0
  const waiting = new Map<number, { resolve: (value: Ingested) => void; reject: (error: unknown) => void }>()

  function start(): Worker | null {
    if (worker !== undefined) return worker
    try {
      worker = new Worker(new URL('../data/ebooks/worker.ts', import.meta.url), { type: 'module', name: 'libellus-ebooks' })
      worker.onmessage = (event: MessageEvent<Reply>) => {
        const reply = event.data
        const call = waiting.get(reply.id)
        if (!call) return
        waiting.delete(reply.id)
        if (reply.ok) call.resolve(reply.result)
        else call.reject(Object.assign(new Error(reply.error.message), { name: reply.error.name, code: reply.error.code }))
      }
      worker.onerror = (event) => {
        // The worker could not load (a missing chunk): everything waiting fails, the next file runs here.
        event.preventDefault()
        for (const call of waiting.values()) call.reject(new Error('worker'))
        waiting.clear()
        worker?.terminate()
        worker = null
      }
    } catch {
      worker = null
    }
    return worker
  }

  return (file) => {
    const running = start()
    // fflate stays out of the app's entry either way: here it comes in its own chunk.
    if (!running) return import('../data/ebooks/ingest').then(({ ingestEbook }) => ingestEbook(file, { dir, files: opfsFiles() }))
    const id = ++next
    return new Promise<Ingested>((resolve, reject) => {
      waiting.set(id, { resolve, reject })
      running.postMessage({ id, file, dir })
    })
  }
}
