/**
 * Loads the WebAssembly decoder for the scanner (issue #92), in the browser,
 * on demand. Both the script (`zxing-wasm/reader`, a chunk of its own) and the
 * module (`zxing_reader.wasm`, 0.9 MB, an asset of its own) are fetched by the
 * first call, when the scanner opens on a browser without a native detector:
 * the app's main bundle does not hold them and the service worker does not
 * precache them (nuxt.config.ts), they are cached as they are used. The
 * package would load its module from a CDN by default; `locateFile` points
 * it at our own copy.
 */
import { createWasmReader, WASM_FRAME_SIDE, type Pixels } from './barcodeReader'
import type { BarcodeReader, FrameSource } from './barcode'

/** Whether this browser can run WebAssembly and draw a frame to a canvas. */
export function wasmReaderAvailable(): boolean {
  return typeof WebAssembly === 'object' && typeof document !== 'undefined'
}

let loading: Promise<typeof import('zxing-wasm/reader')> | null = null

function load() {
  loading ??= (async () => {
    const [zxing, wasm] = await Promise.all([import('zxing-wasm/reader'), import('zxing-wasm/reader/zxing_reader.wasm?url')])
    await zxing.prepareZXingModule({
      overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasm.default : prefix + path) },
      fireImmediately: true,
    })
    return zxing
  })().catch((error) => {
    loading = null
    throw error
  })
  return loading
}

/** One canvas, reused for every frame. */
let canvas: HTMLCanvasElement | null = null

function grabFrame(frame: FrameSource): Pixels | null {
  const video = frame as HTMLVideoElement
  const { videoWidth, videoHeight } = video
  if (!videoWidth || !videoHeight) return null
  const scale = Math.min(1, WASM_FRAME_SIDE / Math.max(videoWidth, videoHeight))
  canvas ??= document.createElement('canvas')
  canvas.width = Math.round(videoWidth * scale)
  canvas.height = Math.round(videoHeight * scale)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

/** The WebAssembly reader, once its script and module are in. Rejects when they cannot be fetched (offline, first time). */
export async function createBrowserWasmReader(): Promise<BarcodeReader> {
  const zxing = await load()
  return createWasmReader({
    grab: grabFrame,
    decode: (pixels, formats) =>
      zxing.readBarcodes(pixels as ImageData, { formats: [...formats] as never, tryInvert: false, maxNumberOfSymbols: 1 }),
  })
}
