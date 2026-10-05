import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

/**
 * Stand-ins for the camera and the barcode detector, for the scanner's flows
 * (barcode-scan.spec.ts in Chromium, barcode-scan-webkit.spec.ts in WebKit). Set
 * up before the app loads; see barcode-scan.spec.ts for what they stand for.
 */

export type Camera = 'ok' | 'denied' | 'none'
export type Stub = {
  camera?: Camera
  /** The native detector's formats; null: the browser has no BarcodeDetector. */
  formats?: string[] | null
  /** A picture the camera shows (a data URL); without one, a colour wash. */
  picture?: string
  /** No camera API at all. */
  noCamera?: boolean
  /** Stand in for `navigator.vibrate` and record its calls (false: leave the browser's own, as on iOS). */
  vibrate?: boolean
  /** Whether the camera's track has a torch (false: as on iOS). */
  torch?: boolean
}

type Probe = {
  __barcode?: string
  __camera: Camera
  __running: number
  __opened: number
  __constraints: unknown[]
  __vibrate: number[]
  __detectorFormats?: string[]
}

/** Installs the stubs before any page script runs. `formats: null`: no BarcodeDetector at all. */
export async function stubScanner(page: Page, { camera = 'ok', formats = ['ean_13', 'code_128', 'code_39'], picture, noCamera = false, vibrate = true, torch = true }: Stub = {}) {
  await page.addInitScript(
    ({ camera, formats, picture, noCamera, vibrate, torch }) => {
      const w = window as unknown as Probe & Record<string, unknown>
      w.__camera = camera
      w.__running = 0
      w.__opened = 0
      w.__constraints = []
      w.__vibrate = []
      if (vibrate) navigator.vibrate = (pattern: VibratePattern) => (w.__vibrate.push(pattern as number), true)

      if (formats) {
        w.BarcodeDetector = class {
          static async getSupportedFormats() {
            return formats
          }
          constructor(options?: { formats?: string[] }) {
            w.__detectorFormats = options?.formats
          }
          async detect() {
            return w.__barcode ? [{ rawValue: w.__barcode, format: 'ean_13' }] : []
          }
        }
      } else delete w.BarcodeDetector

      const devices = navigator.mediaDevices
      if (noCamera) {
        Object.defineProperty(Object.getPrototypeOf(devices), 'getUserMedia', { value: undefined, configurable: true })
        return
      }
      const image = new Image()
      if (picture) image.src = picture
      // On the prototype: WebKit hands the page a MediaDevices whose own properties the page's calls do not see.
      const getUserMedia = async () => {
        if (w.__camera === 'denied') throw new DOMException('Permission denied', 'NotAllowedError')
        if (w.__camera === 'none') throw new DOMException('Requested device not found', 'NotFoundError')
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 480
        const context = canvas.getContext('2d')!
        let hue = 0
        const paint = setInterval(() => {
          if (picture) {
            if (image.complete) context.drawImage(image, 0, 0, 640, 480)
            return
          }
          context.fillStyle = `hsl(${(hue += 5)} 30% 30%)`
          context.fillRect(0, 0, 640, 480)
        }, 40)
        const stream = canvas.captureStream(25)
        const [track] = stream.getVideoTracks()
        track!.getCapabilities = () => (torch ? { torch: true } : {}) as MediaTrackCapabilities
        const applyConstraints = track!.applyConstraints.bind(track)
        track!.applyConstraints = async (constraints) => {
          w.__constraints.push(constraints)
          return applyConstraints({})
        }
        const stop = track!.stop.bind(track)
        w.__opened++
        w.__running++
        let stopped = false
        track!.stop = () => {
          if (!stopped) w.__running--
          stopped = true
          clearInterval(paint)
          stop()
        }
        return stream
      }
      Object.defineProperty(Object.getPrototypeOf(devices), 'getUserMedia', { value: getUserMedia, configurable: true, writable: true })
    },
    { camera, formats, picture, noCamera, vibrate, torch },
  )
}

export const probe = <K extends keyof Probe>(page: Page, key: K) => page.evaluate((k) => (window as unknown as Probe)[k as K], key)
export const see = (page: Page, barcode: string | undefined) => page.evaluate((b) => ((window as unknown as Probe).__barcode = b), barcode)

/** What the camera shows in the WebAssembly flows: a soft, turned, noisy frame holding Piranesi's barcode. */
export const FRAME = `data:image/jpeg;base64,${readFileSync(new URL('../tests/fixtures/barcode/frame-9783641264864.jpg', import.meta.url)).toString('base64')}`

/** The requests the page makes for the decoder (script chunk and module). */
export function watchDecoder(page: Page) {
  const requests: string[] = []
  page.on('request', (request) => /zxing/i.test(request.url()) && requests.push(new URL(request.url()).pathname))
  return requests
}
