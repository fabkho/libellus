/**
 * How long what Home and the Library hold stands for a visit (ms): the three Status lists, the
 * year's count and Home's series are not asked for again within it when a tab is shown
 * (stores/library.ts, stores/series.ts, `load({ ifStale })`). Short, because another device can
 * change the Library and nothing tells this one; long enough that a run of tab switches is one read.
 *
 * Off (0) in the Playwright flows' build (`__LIBELLUS_E2E__`): their flows play the other device
 * (a write straight to the database a second before the tab is shown) and expect it on screen.
 * The window itself is covered by tests/library-fresh.test.ts and measured by the perf harness.
 */
export const FRESH_MS = typeof __LIBELLUS_E2E__ !== 'undefined' && __LIBELLUS_E2E__ ? 0 : 60_000
