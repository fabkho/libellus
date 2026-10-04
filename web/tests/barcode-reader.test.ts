import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import { isbnFromBarcode, startScanLoop, type FrameSource } from '@/utils/barcode'
import {
  createNativeReader,
  createWasmReader,
  nativeCanReadBooks,
  WASM_FORMATS,
  type NativeDetectorClass,
  type Pixels,
} from '@/utils/barcodeReader'

/**
 * The two readers behind the scanner (#92), driven without a camera.
 * Fixtures (tests/fixtures/barcode), written once with zxing-wasm's writer:
 * `ean13-9783641264864.png` the bars of Piranesi's ISBN-13 on a white page;
 * `frame-9783641264864.jpg` a stand-in for a camera frame: the same bars small,
 * off-centre, turned 2.5°, with noise and a soft focus, on a grey cover;
 * `ean13-groceries-4006381333931.png` an EAN-13 that is no book.
 */
const fixture = (name: string) => readFileSync(new URL(`./fixtures/barcode/${name}`, import.meta.url))

/** A picture as the pixels a canvas would give. */
async function pixels(name: string): Promise<Pixels> {
  const { data, info } = await sharp(fixture(name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height }
}

describe('the WebAssembly reader, on pictures of barcodes', () => {
  beforeAll(async () => {
    // The module comes from the package on disk instead of the app's own copy in the browser.
    await prepareZXingModule({
      overrides: { wasmBinary: readFileSync(new URL('../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', import.meta.url)) },
      fireImmediately: true,
    })
  })

  const reader = () =>
    createWasmReader({
      grab: (frame) => (frame as unknown as { pixels: Pixels }).pixels,
      decode: (image, formats) => readBarcodes(image as unknown as ImageData, { formats: [...formats] as never, tryInvert: false, maxNumberOfSymbols: 1 }),
    })
  const frameOf = async (name: string) => ({ pixels: await pixels(name) }) as unknown as FrameSource

  it('reads the EAN-13 of a book, named as the browser names it', async () => {
    const codes = await reader().read(await frameOf('ean13-9783641264864.png'))
    expect(codes).toEqual([{ rawValue: '9783641264864', format: 'ean_13' }])
    expect(isbnFromBarcode(codes[0]!.rawValue)).toBe('9783641264864')
  })

  it('reads it from a small, turned, noisy, soft camera frame', async () => {
    const codes = await reader().read(await frameOf('frame-9783641264864.jpg'))
    expect(codes.map((code) => code.rawValue)).toEqual(['9783641264864'])
  })

  it('reads a code that is no book too: the loop, not the reader, decides', async () => {
    const codes = await reader().read(await frameOf('ean13-groceries-4006381333931.png'))
    expect(codes).toEqual([{ rawValue: '4006381333931', format: 'ean_13' }])
    expect(isbnFromBarcode(codes[0]!.rawValue)).toBeNull()
  })

  it('finds nothing in a frame with no barcode, and nothing before the video has a frame', async () => {
    const blank: Pixels = { data: new Uint8ClampedArray(320 * 240 * 4).fill(128), width: 320, height: 240 }
    expect(await reader().read({ pixels: blank } as unknown as FrameSource)).toEqual([])
    const none = createWasmReader({ grab: () => null, decode: vi.fn() })
    expect(await none.read({})).toEqual([])
  })

  it('asks the decoder for the formats of a book, and drops what it could not validate', async () => {
    const decode = vi.fn(async () => [
      { isValid: false, text: '9780141036144', format: 'EAN13' },
      { isValid: true, text: '0141036141', format: 'Code128' },
    ])
    const codes = await createWasmReader({ grab: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }), decode }).read({})
    expect(decode).toHaveBeenCalledExactlyOnceWith(expect.anything(), WASM_FORMATS)
    expect(codes).toEqual([{ rawValue: '0141036141', format: 'code_128' }])
  })

  it('hands the loop an ISBN from a frame, as it does for the native reader', async () => {
    const frame = await frameOf('frame-9783641264864.jpg')
    const onIsbn = vi.fn()
    let fire: () => void = () => undefined
    startScanLoop({ reader: reader(), source: frame, onIsbn, timers: { set: (callback) => ((fire = callback), 1), clear: () => undefined } })
    fire()
    await vi.waitFor(() => expect(onIsbn).toHaveBeenCalledExactlyOnceWith('9783641264864'))
  })

  it('is slower than the native reader, and says so', () => {
    expect(reader().intervalMs).toBeGreaterThan(250)
  })
})

describe('the native reader', () => {
  /** A BarcodeDetector that "sees" what the test sets, like Chrome's on a camera frame. */
  function fakeDetector(supported: string[] | null, sees: { rawValue: string; format: string }[]) {
    const created: { formats?: string[] }[] = []
    const detect = vi.fn(async () => sees)
    const Detector = class {
      static getSupportedFormats = supported ? async () => supported : undefined
      constructor(options?: { formats?: string[] }) {
        created.push(options ?? {})
      }
      detect = detect
    } as unknown as NativeDetectorClass
    return { Detector, created, detect }
  }

  it('is only used where the detector reads EAN-13', async () => {
    expect(await nativeCanReadBooks(fakeDetector(['ean_13', 'qr_code'], []).Detector)).toBe(true)
    expect(await nativeCanReadBooks(fakeDetector(['qr_code'], []).Detector)).toBe(false)
    expect(await nativeCanReadBooks(fakeDetector(null, []).Detector)).toBe(false)
    expect(await nativeCanReadBooks(null)).toBe(false)
    const refusing = class {
      static getSupportedFormats = async () => Promise.reject(new Error('no'))
    } as unknown as NativeDetectorClass
    expect(await nativeCanReadBooks(refusing)).toBe(false)
  })

  it("asks for the formats of a book's code it supports, and hands over the frame as it is", async () => {
    const seen = [{ rawValue: '9783641264864', format: 'ean_13' }]
    const { Detector, created, detect } = fakeDetector(['qr_code', 'ean_13', 'code_128'], seen)
    const reader = await createNativeReader(Detector)
    expect(created).toEqual([{ formats: ['ean_13', 'code_128'] }])
    const frame = { readyState: 4 }
    expect(await reader.read(frame)).toEqual(seen)
    expect(detect).toHaveBeenCalledExactlyOnceWith(frame)
    // The native reader sets no pace of its own: the loop's default stands.
    expect(reader.intervalMs).toBeUndefined()
  })

  it('works with a detector that cannot say what it supports', async () => {
    const { Detector, created } = fakeDetector(null, [])
    await createNativeReader(Detector)
    expect(created).toEqual([{ formats: ['ean_13', 'code_128', 'code_39'] }])
  })

  it('feeds the loop an ISBN-13 from an ISBN-10 label', async () => {
    const { Detector } = fakeDetector(['ean_13', 'code_128'], [{ rawValue: '0141036141', format: 'code_128' }])
    const onIsbn = vi.fn()
    let fire: () => void = () => undefined
    startScanLoop({ reader: await createNativeReader(Detector), source: { readyState: 4 }, onIsbn, timers: { set: (callback) => ((fire = callback), 1), clear: () => undefined } })
    fire()
    await vi.waitFor(() => expect(onIsbn).toHaveBeenCalledExactlyOnceWith('9780141036144'))
  })
})
