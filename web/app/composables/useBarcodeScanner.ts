import type { MaybeRefOrGetter } from 'vue'
import { startScanLoop, type BarcodeReader } from '~/utils/barcode'
import { createNativeReader, nativeCanReadBooks, type NativeDetectorClass } from '~/utils/barcodeReader'
import { createBrowserWasmReader, wasmReaderAvailable } from '~/utils/barcodeWasm'

/**
 * The camera behind the barcode scanner (issue #92).
 *
 * Two readers behind one interface (`BarcodeReader`): the browser's own
 * `BarcodeDetector` where it reads EAN-13 (Chrome on Android), otherwise a
 * WebAssembly decoder (iOS Safari and the installed iOS app, Firefox), fetched
 * only when the scanner opens. `useBarcodeSupport`: whether the camera button
 * shows — a camera API and one of the two readers. Without a camera (no
 * `getUserMedia`: an old browser, an insecure page) it never shows.
 *
 * `useBarcodeScanner`: the back camera into a `<video>`, a detection loop
 * (utils/barcode.ts) over it, a torch where the track has one (not on iOS).
 * `start()` asks for the camera and says what happened in `state`:
 * asking (the permission prompt is up, or the decoder is loading) → scanning ·
 * denied (the member said no, or the site may not use it) · none (no camera, or
 * one that will not start, or the decoder could not be fetched).
 * `stop()` stops every track, so the camera light goes off; it is safe to call
 * any time, also while the permission prompt is still up.
 */

function nativeClass(): NativeDetectorClass | null {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null
  return (window as unknown as { BarcodeDetector: NativeDetectorClass }).BarcodeDetector
}

const supported = ref(false)
let asked = false

/** Whether the camera button shows: false until the browser has answered. */
export function useBarcodeSupport(): Readonly<Ref<boolean>> {
  if (!asked && import.meta.client) {
    asked = true
    if (navigator.mediaDevices?.getUserMedia) {
      // The WebAssembly decoder covers every browser that can run it, so the button needs no more than that.
      if (wasmReaderAvailable()) supported.value = true
      else void nativeCanReadBooks(nativeClass()).then((ok) => (supported.value = ok))
    }
  }
  return readonly(supported)
}

/** The reader this browser gets: native where it can read books, else the WebAssembly one. */
async function openReader(): Promise<BarcodeReader> {
  const Detector = nativeClass()
  if (Detector && (await nativeCanReadBooks(Detector))) return createNativeReader(Detector)
  return createBrowserWasmReader()
}

export type ScannerState = 'idle' | 'asking' | 'scanning' | 'denied' | 'none'

export function useBarcodeScanner(options: {
  video: MaybeRefOrGetter<HTMLVideoElement | null | undefined>
  onIsbn: (isbn13: string) => void
  onOther?: (rawValue: string) => void
}) {
  const state = ref<ScannerState>('idle')
  const torchSupported = ref(false)
  const torchOn = ref(false)

  let stream: MediaStream | null = null
  let loop: { stop: () => void } | null = null
  /** Bumped by every start and stop: an answer for an older start is thrown away. */
  let run = 0

  function release() {
    loop?.stop()
    loop = null
    for (const track of stream?.getTracks() ?? []) track.stop()
    stream = null
    const video = toValue(options.video)
    if (video) video.srcObject = null
    torchSupported.value = false
    torchOn.value = false
  }

  function stop() {
    run++
    release()
    state.value = 'idle'
  }

  async function start() {
    const mine = ++run
    release()
    state.value = 'asking'
    // The reader loads while the permission prompt is up (the WebAssembly decoder is a download).
    const readerReady = openReader()
    readerReady.catch(() => undefined)
    let opened: MediaStream
    try {
      opened = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
    } catch (error) {
      if (mine !== run) return
      const name = error instanceof DOMException ? error.name : ''
      state.value = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'none'
      return
    }
    // Closed (or restarted) while the prompt was up: the camera goes straight back.
    if (mine !== run) {
      for (const track of opened.getTracks()) track.stop()
      return
    }
    stream = opened
    const track = opened.getVideoTracks()[0]
    const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined
    torchSupported.value = Boolean(capabilities?.torch)

    const video = toValue(options.video)
    if (!video || !track) {
      release()
      state.value = 'none'
      return
    }
    video.srcObject = opened
    try {
      await video.play()
    } catch {
      // Autoplay is allowed for a muted, inline video; a refusal still leaves frames flowing in most browsers.
    }
    if (mine !== run) return

    // The WebAssembly decoder may still have to be fetched: the camera is on, the view says it is working.
    let reader: BarcodeReader
    try {
      reader = await readerReady
    } catch {
      if (mine !== run) return
      release()
      state.value = 'none'
      return
    }
    if (mine !== run) return
    loop = startScanLoop({ reader, source: video, onIsbn: options.onIsbn, onOther: options.onOther })
    state.value = 'scanning'
  }

  async function toggleTorch() {
    const track = stream?.getVideoTracks()[0]
    if (!track || !torchSupported.value) return
    const next = !torchOn.value
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      torchOn.value = next
    } catch {
      // The light would not switch: the button stays as it was.
    }
  }

  /** Stops the detection but keeps the camera running (the book is being looked up). */
  function pause() {
    loop?.stop()
    loop = null
  }

  onUnmounted(stop)
  return { state: readonly(state), torchSupported: readonly(torchSupported), torchOn: readonly(torchOn), start, stop, pause, toggleTorch }
}
