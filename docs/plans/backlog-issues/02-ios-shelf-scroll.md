Title: iOS: the shelf's row and the 3D Stack cannot be scrolled (Regal)
Labels: bug, priority:high
Package: WP-02 · item #26 · tier P0 · size M · model Opus (debugging) · depends on: none · wave 1 · work happens in fabkho/regal
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/02-ios-shelf-scroll.md)" --label bug --label priority:high --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/02-ios-shelf-scroll.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
On iOS the 3D shelf cannot be scrolled: Regal's row (`RegalBooksRow`, on the Profile and a year in review) and the Stack (`/profile/shelf`). Android works.

## What the code says (fabkho/regal origin/main 3376fce)
- Row: the scroller is `overflow-x: auto` with `touch-action: pan-y` (`app/components/row/Card.vue:1065-1074`); a finger moves it only through JavaScript on `pointermove` (`onPointerDownCapture` :249, `onTouchDragMove` :258), and any `pointercancel` ends the drag. The reason is Chrome-only: a native touch scroll ends in `pointercancel`, which keeps `navigator.vibrate` blocked (`app/utils/row/touchDrag.ts:1-8`). iOS has no Vibration API.
- Stack: the canvas is `touch-action: none` (`app/components/LibraryStage.vue:335`); `pointermove`/`pointerup` on `window`, no `setPointerCapture`, and `onPointerMove` drops the drag unless `event.buttons & 1` (`app/components/stack/Scene.vue`).
- Libellus: `pages/profile/shelf.vue:91` (`fixed inset-0 overflow-hidden`), `assets/css/main.css:349-357` (`overflow-x: clip; overscroll-behavior-x: none` on html/body). No `position: fixed` body lock.
- Libellus builds Regal from the default branch, unpinned (`web/regal.config.ts:17-25`). `/Users/fabkho/code/regal` is a stale checkout (b82bf40): work from origin/main.

## Scope
1. Diagnostics overlay behind `?touchdebug` in Regal: event sequence (type, pointerType, buttons, cancel), computed touch-action, scrollLeft.
2. Row: use the JavaScript drag only where `'vibrate' in navigator`; elsewhere native scrolling (`touch-action: pan-x pan-y`).
3. Stack: no `buttons` guard for non-mouse pointers, `setPointerCapture` on pointerdown, explicit `pointercancel` handling.
4. Unit tests replaying touch sequences (`tests/unit/rowTouchDrag.test.ts` and a Stack equivalent), incl. `buttons = 0` and `pointercancel`.
5. Owner verifies on his iPhone (Safari tab and home-screen app) via a preview; Safari Web Inspector over USB if needed.
6. Libellus only if the cause is `main.css` (hypothesis 3). Propose pinning the Regal commit in `web/regal.config.ts` (ask first).

## Acceptance criteria
- [ ] On the owner's iPhone the Profile's row and a year's row swipe sideways; `/profile/shelf`'s Stack scrolls and flings.
- [ ] The page still scrolls vertically over a row.
- [ ] Android unchanged, including the scroll ticks (vibration).
- [ ] Regal unit tests green; the cause written down in the PR.

## Notes
- What a worker can test: Playwright WebKit with `devices['iPhone 15']` (as `web/playwright.config.ts` does) and synthetic pointer/touch events. Not iOS gesture arbitration: only a real device proves the fix.
- Building Libellus with the shelf needs `LIBELLUS_REGAL=1` plus `REGAL_LAYER` or `GIGET_AUTH`.
- Owner questions: iOS version; Safari or home-screen app; which screens; did it ever work on iOS; pin Regal?
