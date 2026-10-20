// The UI base's `ui.icons` (fabkho/ui, README, "Icon drawings"): the drawings BetterReads keeps of its own, over
// the base's. A name left out is the base's drawing. Three differ (every name of the set was diffed against the
// base's, 2026-10-20); the base keeps Bookretreats' hand for them. Stroke, size and colour are the base's `UiIcon`'s,
// so these are only the shapes on the 24-unit grid. docs/DESIGN.md, Icons.
export default defineAppConfig({
  ui: {
    icons: {
      // Two readers: a head and shoulders, and a second one behind it to the right.
      people: '<circle cx="9.5" cy="8.5" r="3" /><path d="M4 19c.4-3.2 2.5-5 5.5-5s5.1 1.8 5.5 5" /><path d="M15.5 5.7a3 3 0 0 1 0 5.6M17.5 14.3c1.4.6 2.3 2.1 2.5 4.2" />',
      // Like: a heart; the like's button fills it (`fill-current`) once pressed.
      heart: '<path d="M12 20c-4.4-3-7.5-5.9-7.5-9.4A4.1 4.1 0 0 1 8.6 6.5c1.4 0 2.7.8 3.4 2 .7-1.2 2-2 3.4-2a4.1 4.1 0 0 1 4.1 4.1c0 3.5-3.1 6.4-7.5 9.4Z" />',
      // A link that leaves the app (profile links, WP-22): an arrow out of the top right corner of a square.
      external: '<path d="M10 6H7.5A1.5 1.5 0 0 0 6 7.5v9A1.5 1.5 0 0 0 7.5 18h9a1.5 1.5 0 0 0 1.5-1.5V14M13 5.5h5.5V11M18.2 5.8 11 13" />',
    },
  },
})
