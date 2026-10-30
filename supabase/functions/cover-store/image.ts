/**
 * What an image is, read from its first bytes and nothing else: the format by its magic bytes (never the host's
 * `Content-Type`, never the file's name) and the REAL width and height from the header (JPEG SOF, WebP VP8 / VP8L /
 * VP8X, PNG IHDR, GIF's screen): a few bytes, no decoding. The widths stored in `books.cover_widths` are these, because
 * Apple's `bb` box keeps a cover's proportions (a 600 × 900 box is 568 × 900 for a 0.63 cover) and Open Library's sizes
 * are not fixed. Framework-free.
 */

export type ImageKind = 'jpeg' | 'webp' | 'png' | 'gif'
export type ImageInfo = { kind: ImageKind; mime: string; width: number; height: number }

const MIME: Record<ImageKind, string> = { jpeg: 'image/jpeg', webp: 'image/webp', png: 'image/png', gif: 'image/gif' }

/** Under this on either side a cover is a placeholder, not a cover (Open Library's 1 × 1 GIF, a spacer): `gone`. */
export const MIN_SIDE = 16

const ascii = (bytes: Uint8Array, at: number, text: string): boolean => {
  if (at + text.length > bytes.length) return false
  for (let index = 0; index < text.length; index++) if (bytes[at + index] !== text.charCodeAt(index)) return false
  return true
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null
    let marker = bytes[at + 1]!
    at += 2
    // Fill bytes: any number of 0xFF before the marker code.
    while (marker === 0xff && at < bytes.length) marker = bytes[at++]!
    // Markers without a length: TEM, RSTn, SOI, EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue
    if (at + 2 > bytes.length) return null
    const length = (bytes[at]! << 8) | bytes[at + 1]!
    // SOFn (not DHT 0xC4, JPG 0xC8, DAC 0xCC): precision, height, width.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 7 > bytes.length) return null
      return { height: (bytes[at + 3]! << 8) | bytes[at + 4]!, width: (bytes[at + 5]! << 8) | bytes[at + 6]! }
    }
    // The scan starts: no frame header came before it.
    if (marker === 0xda || length < 2) return null
    at += length
  }
  return null
}

function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (!ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP')) return null
  if (ascii(bytes, 12, 'VP8X')) {
    if (bytes.length < 30) return null
    return {
      width: (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1,
      height: (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1,
    }
  }
  if (ascii(bytes, 12, 'VP8L')) {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null
    return {
      width: (bytes[21]! | ((bytes[22]! & 0x3f) << 8)) + 1,
      height: ((bytes[22]! >> 6) | (bytes[23]! << 2) | ((bytes[24]! & 0x0f) << 10)) + 1,
    }
  }
  if (ascii(bytes, 12, 'VP8 ')) {
    // Frame tag (3 bytes), the start code 9d 01 2a, then 14-bit width and height (the top two bits are a scale).
    if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null
    return { width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff, height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff }
  }
  return null
}

function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || !ascii(bytes, 12, 'IHDR')) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function gifSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10) return null
  return { width: bytes[6]! | (bytes[7]! << 8), height: bytes[8]! | (bytes[9]! << 8) }
}

/** The format and real size of an image, or null when these are not the bytes of a JPEG, WebP, PNG or GIF (or the header is cut). */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  let kind: ImageKind | null = null
  let size: { width: number; height: number } | null = null
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    kind = 'jpeg'
    size = jpegSize(bytes)
  } else if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) {
    kind = 'webp'
    size = webpSize(bytes)
  } else if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 'PNG\r\n') && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    kind = 'png'
    size = pngSize(bytes)
  } else if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) {
    kind = 'gif'
    size = gifSize(bytes)
  }
  if (!kind || !size || size.width < 1 || size.height < 1) return null
  return { kind, mime: MIME[kind], ...size }
}
