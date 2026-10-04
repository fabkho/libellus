/**
 * The two ways to read a barcode out of the camera's frame (issue #92), behind
 * one interface (`BarcodeReader`, utils/barcode.ts). Framework-free; what is
 * browser-bound (the canvas, the module load) comes in from outside, so Vitest
 * drives both with a fixture image and fakes.
 *
 * - **Native**: the browser's `BarcodeDetector`, which reads the `<video>`
 *   itself. Chrome on Android; free, fast, no download.
 * - **WebAssembly**: zxing-cpp compiled to WebAssembly (the `zxing-wasm`
 *   package, 40 KB of script and a 0.9 MB module). Everywhere else: iOS Safari
 *   and the installed iOS web app, Firefox. A frame is drawn onto a canvas at a
 *   modest size and decoded from its pixels. It is only fetched when the
 *   scanner opens (utils/barcodeWasm.ts), never with the app.
 */
import type { BarcodeReader, DetectedCode, FrameSource } from './barcode'

// ------------------------------------------------------------------- native

/** What a book's code can be printed as: the EAN-13 bars; an ISBN-10 as Code 128 / 39. */
export const NATIVE_FORMATS = ['ean_13', 'code_128', 'code_39'] as const

/** The part of the browser's `BarcodeDetector` class the reader uses. */
export type NativeDetectorClass = {
  new (options?: { formats?: string[] }): { detect: (source: never) => Promise<readonly DetectedCode[]> }
  getSupportedFormats?: () => Promise<string[]>
}

/** Whether this class can read EAN-13, the one format a book's barcode needs. */
export async function nativeCanReadBooks(Detector: NativeDetectorClass | null | undefined): Promise<boolean> {
  if (!Detector) return false
  try {
    return (await Detector.getSupportedFormats?.())?.includes('ean_13') ?? false
  } catch {
    return false
  }
}

/** The browser's own detector, asked for the formats of a book's code it supports. */
export async function createNativeReader(Detector: NativeDetectorClass): Promise<BarcodeReader> {
  const known = (await Detector.getSupportedFormats?.().catch(() => undefined)) ?? [...NATIVE_FORMATS]
  const formats = NATIVE_FORMATS.filter((format) => known.includes(format))
  const detector = new Detector({ formats: formats.length ? [...formats] : ['ean_13'] })
  return { read: (frame: FrameSource) => detector.detect(frame as never) }
}

// --------------------------------------------------------------------- wasm

/** The pixels of one frame, as a canvas gives them (`ImageData`'s shape). */
export type Pixels = { data: Uint8ClampedArray; width: number; height: number }

/** What the decoder says about one symbol (the part of zxing-wasm's `ReadResult` that is read). */
export type DecodedSymbol = { isValid: boolean; text: string; format: string }

/** The formats the decoder is asked for, in zxing's names. */
export const WASM_FORMATS = ['EAN13', 'Code128', 'Code39'] as const

/** The longest side of the frame the decoder sees, in px: a barcode across a phone's width stays readable. */
export const WASM_FRAME_SIDE = 960

/** The decoder's pace: ~3 frames a second; one frame takes it a few tens of ms. */
export const WASM_INTERVAL_MS = 330

/** zxing's format names → the browser's (`EAN13` → `ean_13`), so both readers say the same. */
function browserFormat(format: string): string {
  return format.replace(/^EAN(\d+)$/, 'ean_$1').replace(/^Code(\d+)$/, 'code_$1').toLowerCase()
}

/**
 * The WebAssembly reader. `grab` copies the frame's pixels (a canvas, in the
 * browser; null when there is nothing to read yet), `decode` is the decoder.
 */
export function createWasmReader({
  grab,
  decode,
}: {
  grab: (frame: FrameSource) => Pixels | null
  decode: (pixels: Pixels, formats: readonly string[]) => Promise<readonly DecodedSymbol[]>
}): BarcodeReader {
  return {
    intervalMs: WASM_INTERVAL_MS,
    async read(frame) {
      const pixels = grab(frame)
      if (!pixels) return []
      const symbols = await decode(pixels, WASM_FORMATS)
      return symbols.filter((symbol) => symbol.isValid && symbol.text).map((symbol) => ({ rawValue: symbol.text, format: browserFormat(symbol.format) }))
    },
  }
}
