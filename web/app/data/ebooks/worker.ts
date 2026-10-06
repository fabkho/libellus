/// <reference lib="webworker" />
import { opfsFiles } from './files'
import { ingestEbook } from './ingest'

/**
 * Takes ebook files in off the main thread (issue #131): reads each one's
 * metadata and cover with fflate, fingerprints it and copies it into the
 * origin private file system (`ingestEbook`). One message per file:
 * `{ id, file, dir }` in, `{ id, ok, result | error }` out. Started by
 * `utils/ebookWorker.ts`; fflate lives only in this worker's chunk.
 */
const files = opfsFiles()

self.onmessage = async (event: MessageEvent<{ id: number; file: Blob; dir: string }>) => {
  const { id, file, dir } = event.data
  try {
    const result = await ingestEbook(file, { dir, files })
    self.postMessage({ id, ok: true, result })
  } catch (error) {
    const { name, message, code } = error as { name?: string; message?: string; code?: string }
    self.postMessage({ id, ok: false, error: { name: name ?? 'Error', message: message ?? String(error), code } })
  }
}
