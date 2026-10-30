import { assertEquals } from '@std/assert'
import { sniffImage } from './image.ts'
import { fixture, jpegOf } from './test_support.ts'

Deno.test('Apple\'s WebP: the real widths come from the VP8X header, not from the box that was asked', () => {
  // 600x900, 360x540, 240x360 and 120x180 boxes of a cover that is 0.63 wide for 1 high.
  assertEquals(sniffImage(fixture('apple-600x900.webp')), { kind: 'webp', mime: 'image/webp', width: 568, height: 900 })
  assertEquals(sniffImage(fixture('apple-360x540.webp'))?.width, 341)
  assertEquals(sniffImage(fixture('apple-240x360.webp'))?.width, 227)
  assertEquals(sniffImage(fixture('apple-120x180.webp'))?.width, 114)
})

Deno.test('JPEG: Open Library\'s sizes and a progressive Goodreads image, from the frame header', () => {
  assertEquals(sniffImage(fixture('ol-L.jpg')), { kind: 'jpeg', mime: 'image/jpeg', width: 337, height: 500 })
  assertEquals(sniffImage(fixture('ol-M.jpg'))?.width, 180)
  assertEquals(sniffImage(fixture('ol-S.jpg'))?.width, 39)
  assertEquals(sniffImage(fixture('goodreads.jpg'))?.width, 318) // progressive (SOF2)
  assertEquals(sniffImage(fixture('apple-66x100.jpg'))?.height, 100)
  assertEquals(sniffImage(jpegOf(1234, 777)), { kind: 'jpeg', mime: 'image/jpeg', width: 1234, height: 777 })
})

Deno.test('WebP lossless and lossy headers, PNG and GIF', () => {
  // VP8L: signature 0x2f, then 14 bits of width - 1 and 14 bits of height - 1 (here 300 x 450).
  const width = 300 - 1
  const height = 450 - 1
  const bits = (width & 0x3fff) | ((height & 0x3fff) << 14)
  const vp8l = Uint8Array.from([
    ...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8L'), 5, 0, 0, 0, 0x2f,
    bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >> 24) & 255,
  ])
  assertEquals(sniffImage(vp8l), { kind: 'webp', mime: 'image/webp', width: 300, height: 450 })

  const vp8 = Uint8Array.from([
    ...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8 '), 10, 0, 0, 0, 0, 0, 0,
    0x9d, 0x01, 0x2a, 200 & 255, 200 >> 8, 310 & 255, 310 >> 8,
  ])
  assertEquals(sniffImage(vp8), { kind: 'webp', mime: 'image/webp', width: 200, height: 310 })

  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...new TextEncoder().encode('IHDR'),
    0, 0, 0x01, 0x2c, 0, 0, 0x01, 0xf4, 8, 2, 0, 0, 0,
  ])
  assertEquals(sniffImage(png), { kind: 'png', mime: 'image/png', width: 300, height: 500 })

  // Open Library's "no cover" placeholder: a 1 x 1 GIF.
  const gif = Uint8Array.from([...new TextEncoder().encode('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0x3b])
  assertEquals(sniffImage(gif), { kind: 'gif', mime: 'image/gif', width: 1, height: 1 })
})

Deno.test('what is not an image, or has a cut header, is nothing (the Content-Type is never believed)', () => {
  const text = new TextEncoder()
  assertEquals(sniffImage(text.encode('<!doctype html><title>Nope</title>')), null)
  assertEquals(sniffImage(text.encode('{"error":"not found"}')), null)
  assertEquals(sniffImage(new Uint8Array()), null)
  assertEquals(sniffImage(fixture('ol-L.jpg').slice(0, 12)), null)
  assertEquals(sniffImage(fixture('apple-600x900.webp').slice(0, 20)), null)
  assertEquals(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2])), null) // the scan, no frame header
})
