# The composer, as it ships

Shots of the built app (Chromium with a fake microphone, iPhone 15 in the flows' own configuration, device pixel ratio 3: WebKit cannot fake a
microphone, and the microphone at Only me is half of what these show) after the split send button, the end of the spoiler marks, the private
voice notes, and `@fabkho/ui` 0.13.2 (the tab and the menu say **Send to** / **Senden an**, and the field keeps the soft keyboard through a
whole recording): `docs/parity.md` (*Notes, a chapter*, *Notes, visibility*, *Buddy read, a thread*) and `docs/plans/notes-composer.md` (V3).

| Prefix | What |
|---|---|
| `1-rest` | a chapter's thread at rest: the capsule with the split send button on Friends |
| `2-menu` | the tab opened: *Send to* — Only me, Friends (checked), Everyone, each with its line |
| `3-typing-keyboard` | typing, with a keyboard under it (291 px, drawn: WebKit has none); the button is untouched by the keyboard |
| `3b-menu-keyboard` | the same with the menu open: it drops the hint lines where the keyboard leaves it little room |
| `4-everyone` | *Everyone*: the send button in the lamp amber, the tab's word, the one quiet line over the capsule |
| `5-onlyme` | *Only me*: the calm button, the tab's word, the note free to be written |
| `5b-onlyme-mic` | *Only me* with nothing written: the **microphone** stands where Send is (a voice note is only ever hers) |
| `5c-onlyme-typing-keyboard` | *Only me*, typing: Send again, the tab still says the audience |
| `5d-onlyme-recording-keyboard` | *Only me*, a **hold** in progress: the keyboard stays up under the recording (the field kept the focus), the timer and "Slide to cancel" in the capsule |
| `5e-onlyme-locked` | *Only me*, **locked**: the recording goes on without the finger, the panel (✕, the bars, the timer, send) on the keyboard that never went away |
| `6-reply-menu` | answering Anna's Friends note: *Everyone* is in the menu, off, with the reason |
| `7-buddy-rest` | a buddy-read Section: the field, the microphone, no Spoiler chip and nothing over the field |
| `8-buddy-typing-keyboard` | the same, typing, with the keyboard |

Four passes: 390×844 light EN, 390×844 dark DE, 360×640 light DE, 360×640 dark EN.

They were taken by a throwaway Playwright spec (the flows' fixtures: a friend, a Book with 43 chapters) that screenshots the
page, shrinks the viewport by the keyboard's height, and composes the drawn keyboard under the shot. It is not committed: it is a few lines on
`e2e/fixtures.ts` and the `@playwright/test` page API, and the mocks in `docs/prototypes/notes-composer/` (that PR) still exercise the same
composer interactively.
