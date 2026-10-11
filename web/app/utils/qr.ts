import { encode } from 'uqr'

/**
 * A QR code drawn by the app itself (social v2b, the follow link as a QR code): `uqr` (MIT, no dependencies)
 * makes the modules in the browser, so the link never leaves the device, and this turns them into an SVG path.
 * Error correction M (about 15 % of the code can be damaged), the smallest version that holds the text.
 */
export type QrCode = { size: number; version: number; path: string }

/** The quiet zone the QR standard asks for around the modules, in modules. */
export const QR_QUIET_ZONE = 4

/**
 * The code for `text`: `size` modules a side, and `path` the dark modules as one SVG path (a run of dark modules
 * in a row is one `h`), in module units with the origin at the first module. Draw it in a viewBox that is `size`
 * plus a quiet zone either side, offset by `QR_QUIET_ZONE`.
 */
export function qrCode(text: string): QrCode {
  const { data, size, version } = encode(text, { ecc: 'M', border: 0 })
  let path = ''
  for (let y = 0; y < size; y++) {
    const row = data[y]!
    for (let x = 0; x < size; x++) {
      if (!row[x]) continue
      let run = 1
      while (x + run < size && row[x + run]) run++
      path += `M${x} ${y}h${run}v1h-${run}z`
      x += run
    }
  }
  return { size, version, path }
}
