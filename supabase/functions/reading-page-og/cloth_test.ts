/**
 * A Book without a cover is drawn on the Placeholder's cloth in the Open Graph image as in the app: the
 * same six colours (tokens `color.cloth1…6`), the same cloth for the same title (web/app/utils/cover.ts `clothOf`).
 *
 *   cd supabase/functions/reading-page-og && deno test
 */
import { assertEquals } from '@std/assert'
import { CLOTHS, clothFor } from './render.ts'

Deno.test('the cloth of a title is the one the app gives it', () => {
  // Values of `clothOf` in the web app (1–6) for these titles.
  const expected: Record<string, number> = { Piranesi: 6, Emma: 1, Ulysses: 5, 'Effi Briest': 2, Siddhartha: 3, 'Märchen für Erwachsene': 3, '': 1 }
  for (const [title, cloth] of Object.entries(expected)) assertEquals(clothFor(title), CLOTHS[cloth - 1], title)
})

Deno.test('the same title always gets the same cloth, and the six colours are the design tokens', () => {
  assertEquals(clothFor('Kindred'), clothFor('Kindred'))
  assertEquals([...CLOTHS], ['#3b2430', '#22303f', '#2c3a2e', '#4a3220', '#30293f', '#4a2624'])
})
