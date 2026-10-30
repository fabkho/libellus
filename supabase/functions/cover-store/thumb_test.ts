import { assert, assertEquals } from '@std/assert'
import { DECODE_BUDGET_MS, describeJpeg, GOODREADS_PER_RUN, shrink, thumbBudget } from './thumb.ts'
import { fixture, jpegOf } from './test_support.ts'

Deno.test('a JPEG is described by the app\'s own describeCover: a thumbhash and two colours', () => {
  for (const name of ['apple-66x100.jpg', 'ol-M.jpg', 'ol-L.jpg', 'goodreads.jpg', 'goodreads-100.jpg']) {
    const described = describeJpeg(fixture(name))
    assert(described, name)
    assert(/^[A-Za-z0-9+/]+=*$/.test(described.thumbhash) && described.thumbhash.length >= 20 && described.thumbhash.length <= 40, `${name}: ${described.thumbhash}`)
    assert(/^#[0-9a-f]{6}$/.test(described.colors.dominant) && /^#[0-9a-f]{6}$/.test(described.colors.secondary), name)
  }
})

Deno.test('what cannot be decoded gives null, never a throw: WebP, a header with no picture, garbage, too many pixels', () => {
  assertEquals(describeJpeg(fixture('apple-120x180.webp')), null)
  assertEquals(describeJpeg(jpegOf(100, 100)), null)
  assertEquals(describeJpeg(new TextEncoder().encode('<html>')), null)
  assertEquals(describeJpeg(jpegOf(3000, 3000)), null)
  assertEquals(describeJpeg(jpegOf(1200, 1000)), null) // over 1 MP: not decoded, whatever the bytes after the header
})

Deno.test('shrink: a box filter to at most 100 px on the longer side, the proportions kept; small images untouched', () => {
  const white = { width: 300, height: 450, data: new Uint8Array(300 * 450 * 4).fill(255) }
  const small = shrink(white)
  assertEquals([small.width, small.height], [67, 100])
  assert(small.data.every((value) => value === 255))
  const tiny = { width: 40, height: 60, data: new Uint8Array(40 * 60 * 4) }
  assertEquals(shrink(tiny), tiny)
  // Left half black, right half white: the halves stay apart.
  const half = { width: 200, height: 200, data: new Uint8Array(200 * 200 * 4) }
  for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) half.data.set(x < 100 ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * 200 + x) * 4)
  const shrunk = shrink(half)
  assertEquals([shrunk.data[0], shrunk.data[(99 * 4)]], [0, 255])
})

Deno.test('the budget: 2 Goodreads Books a run, counted exactly; no decode starts once 500 ms were spent', () => {
  assertEquals([GOODREADS_PER_RUN, DECODE_BUDGET_MS], [2, 500])
  const budget = thumbBudget()
  assertEquals([budget.admit('goodreads'), budget.admit('goodreads'), budget.admit('goodreads')], [true, true, false])
  // The others are not capped by count.
  for (let index = 0; index < 10; index++) assert(budget.admit('apple'))

  let clock = 0
  const spent = thumbBudget({ now: () => clock })
  assert(spent.canDecode())
  assertEquals(spent.measure(() => (clock += 499, 'a')), 'a')
  assert(spent.canDecode() && spent.admit('apple'))
  spent.measure(() => (clock += 1, 'b'))
  assertEquals([spent.spentMs(), spent.canDecode(), spent.admit('apple'), spent.admit('goodreads')], [500, false, false, false])
  // A decode that throws is measured too.
  const failing = thumbBudget({ now: () => clock })
  try {
    failing.measure(() => { clock += 700; throw new Error('x') })
  } catch { /* measured */ }
  assertEquals(failing.canDecode(), false)
})
