/**
 * Reading a book's barcode (issue #92). Pure and framework-free: what the camera
 * saw (`BarcodeDetector`'s raw values) becomes an ISBN-13 or nothing, and the
 * detection loop takes its reader and its clock from outside, so Vitest drives
 * both with fakes and no camera.
 *
 * A book's barcode is an EAN-13 whose digits are the ISBN-13: it starts 978 or
 * 979 (Bookland). Other EAN-13s (a groceries barcode, a magazine's 977 ISSN) are
 * not books. An ISBN-10 can turn up too (a Code 128 or Code 39 label, or typed
 * under the bars); it is converted. The check digit is verified either way, so a
 * misread never goes on to a lookup.
 */
import { isValidIsbn10, isValidIsbn13, parseIsbn } from '../data/books'

/** The ISBN-13 a scanned value stands for, or null when it is not a book's barcode. */
export function isbnFromBarcode(rawValue: string): string | null {
  const value = rawValue.replace(/[\s-]/g, '').toUpperCase()
  if (/^\d{13}$/.test(value)) return isValidIsbn13(value) ? value : null
  if (/^\d{9}[\dX]$/.test(value)) return isValidIsbn10(value) ? parseIsbn(value) : null
  return null
}

/** A barcode a reader found: its text, and the format it was printed in when the reader says. */
export type DetectedCode = { rawValue: string; format?: string }

/** The part of a `<video>` the loop reads: only a frame that has data is worth reading. */
export type FrameSource = { readyState?: number }

/**
 * Something that reads the barcodes in the camera's current frame. One interface
 * over two implementations (utils/barcodeReader.ts): the browser's own
 * `BarcodeDetector` (Chrome on Android) and a WebAssembly decoder (every other
 * browser, iOS Safari included). The loop above them does not know which it has.
 */
export type BarcodeReader = {
  /** The codes in this frame; a frame that cannot be read gives none or rejects. */
  read: (frame: FrameSource) => Promise<readonly DetectedCode[]>
  /** How often a frame is worth reading, in ms: the WebAssembly decoder is slower than the native one. */
  intervalMs?: number
}

/** Enough data for the current frame (`HTMLMediaElement.HAVE_CURRENT_DATA`). */
const HAVE_CURRENT_DATA = 2

/** How often a frame is looked at by default, in ms: ~4 a second is plenty for a held-still book and easy on the battery. */
export const SCAN_INTERVAL_MS = 250

export type ScanLoopOptions = {
  reader: BarcodeReader
  source: FrameSource
  /** The first ISBN-13 seen; the loop stops itself before calling it. */
  onIsbn: (isbn13: string) => void
  /** A barcode was seen that is not a book's (a grocery's EAN, an ISSN, a misread): the loop goes on. */
  onOther?: (rawValue: string) => void
  intervalMs?: number
  /** Timers, injected by tests. */
  timers?: {
    set: (callback: () => void, ms: number) => unknown
    clear: (handle: unknown) => void
  }
}

/**
 * Looks at the camera's frame every `intervalMs`, one detection at a time (a slow
 * detection delays the next look instead of piling up), until a book's barcode
 * is found or `stop()`. A frame that cannot be read (the video is not playing
 * yet, the reader refuses one) is skipped, not fatal.
 */
export function startScanLoop({
  reader,
  source,
  onIsbn,
  onOther,
  intervalMs = reader.intervalMs ?? SCAN_INTERVAL_MS,
  timers = { set: (callback, ms) => setTimeout(callback, ms), clear: (handle) => clearTimeout(handle as number) },
}: ScanLoopOptions): { stop: () => void } {
  let stopped = false
  let handle: unknown = null

  function next() {
    if (!stopped) handle = timers.set(() => void look(), intervalMs)
  }

  async function look() {
    handle = null
    if (stopped) return
    if (source.readyState !== undefined && source.readyState < HAVE_CURRENT_DATA) return next()
    let codes: readonly DetectedCode[] = []
    try {
      codes = await reader.read(source)
    } catch {
      // A frame the reader cannot read: the next one may be fine.
    }
    if (stopped) return
    for (const code of codes) {
      const isbn = isbnFromBarcode(code.rawValue)
      if (isbn) {
        stopped = true
        onIsbn(isbn)
        return
      }
    }
    if (codes[0]) onOther?.(codes[0].rawValue)
    next()
  }

  next()
  return {
    stop() {
      stopped = true
      if (handle !== null) timers.clear(handle)
      handle = null
    },
  }
}
