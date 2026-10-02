# Libellus — Design Guideline

**Not written yet.** The visual direction is chosen in the design prototyping round (#4) — several
genuinely different prototypes, Fabian picks one — and ported as the design system (#5). This file
is filled then, the way Trappist's `docs/DESIGN.md` was: principles, colour roles, type, spacing and
radius, chrome, components, copy tone, accessibility, don'ts.

Until then:
- `design/tokens.json` holds **neutral placeholders**: a grey palette by role (`surface`, `ink`,
  `inkMuted`, `accent`, …), Inter as the only family, a small type, spacing and radius scale. Screens
  name roles, never hues, so the design round only changes values.
- Rules that hold regardless of the direction live in `web/AGENTS.md`: tokens only, no raw colours,
  mobile first, 44px touch targets, every string from the message file, `data-testid` on every
  interactive element.
