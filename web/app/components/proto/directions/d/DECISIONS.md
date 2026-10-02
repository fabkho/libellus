# Direction D — decisions

D ("Night Reader") is the chosen direction. This file records what was decided
in the polish rounds, so the real screens can be built from it.

## Settled

- **Room → theme.** Night and Day are the app's dark and light theme. There is
  no Dim.
- **Cover glow** is always on.
- **Book titles** are serif (Newsreader).
- **Sheets** keep a text "Cancel" at the top left (no round ✕).
- **Search is an overlay, never a page.** The tab bar grows into an upside-down
  command palette over whatever page you are on, which stays behind it,
  blurred and dimmed.
  - The bottom row keeps Home and Library at the left (the current tab stays
    lit) and the query takes the rest.
  - Above the query sit the source strip (Libellus · Apple Books · Open
    Library, with counts) and its lamp hairline, then the results.
  - The best match is at the bottom, next to the query.
  - While typing, the palette sits right above the keyboard; Cancel replaces
    the tabs.
  - Search works from every page, including the book page.
- **Tapping a result** opens its book page and closes the search.
- **Tapping + on a result** opens the Add to Library sheet (choose Status,
  then the dates).
- **Closing the search** works three ways: Cancel while typing, tapping the
  blurred page, and swiping the palette down.
- **No profile screen.** Tapping the avatar opens a small menu that holds the
  theme switch (and later anything else account-related).

## Theme switch

There are only two visible states, Light and Dark, and no "Match the phone"
option.

- **Until the Member first taps the switch,** the app follows the phone's
  appearance. No preference is stored.
- **The first tap stores the opposite of what is showing right now.** On a
  dark phone the first tap stores Light.
- **Every later tap flips** between Light and Dark.

So the stored preference is `null | 'light' | 'dark'`, and `null` means
"follow the phone". There is no way back to `null` from the UI. That is
accepted for now.

## Later

- **The morph between the tab bar and the search palette**, as iOS 26 and
  the iOS 26 Apple Books app do it:
  - the capsule widens into the palette;
  - Search's icon slides into the query row while Home and Library stay put;
  - the result list unrolls upwards.

  Closing reverses all of it. Not prototyped yet.
