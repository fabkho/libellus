import { readEpub } from './epub'
import { EPUB_READER_VERSION, fileIdOf, FINGERPRINT_BYTES, sha256Hex, type EbookFiles, type Ingested } from './files'

/**
 * Takes one EPUB in: reads its metadata and cover (`readEpub`), fingerprints
 * it, and copies it (and the cover) into `dir` unless that copy is there
 * already. Throws `EpubError` for a file that is not an EPUB. Runs in the
 * worker (data/ebooks/worker.ts) with OPFS, in the tests with memory.
 */
export async function ingestEbook(file: Blob, { dir, files }: { dir: string; files: EbookFiles }): Promise<Ingested> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { cover, ...metadata } = readEpub(bytes)
  const hash = await sha256Hex(bytes.subarray(0, FINGERPRINT_BYTES))
  const id = fileIdOf(hash, bytes.length)
  const path = `${dir}/${id}.epub`
  let wrote = false
  if ((await files.size(path)) !== bytes.length) {
    await files.write(path, bytes)
    wrote = true
  }
  let coverPath: string | null = null
  if (cover) {
    coverPath = `${dir}/${id}.cover`
    if ((await files.size(coverPath)) !== cover.length) await files.write(coverPath, cover)
  }
  return { id, hash, size: bytes.length, path, coverPath, metadata, reader: EPUB_READER_VERSION, wrote }
}
