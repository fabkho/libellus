# German: the first full translation and its review

`web/i18n/locales/de.json` holds all 1,561 keys of `en.json` (2026-10-11), made with `pnpm i18n:translate` (the-i18n-kit 8.3.0, `gemini-3.8-flash`, the context in `web/i18n/kit/`): 32 requests, about $0.21, no key failed the kit's own placeholder and plural checks, and `pnpm i18n:verify` reports **0 errors** (every key present, no extra, identical `{placeholders}` per plural form, identical `|` forms, `@:` links and `{'@'}`). The messages compile in the build (`tests/i18n-runtime-only.test.ts`) and `nuxt generate` passes.

## Review pass

Five reviewers (Sonnet 5.5, each reading a fifth of the file against `ai-context.md` and `glossary.json`) proposed 83 changes; I read every one and kept all of them, then made about a dozen more of my own after searching for the same faults elsewhere. About one string in sixteen needed a hand; the rest stands as the model wrote it. The kinds of fix:

| Kind | Examples |
| --- | --- |
| A mistranslation | "Hake ab" (tick) for *untick*; "Beendet am" for *Stopped on* (now *Abgebrochen am*); "Serife" for *Serif*; "Rose" for the colour *rose* (now *Rosa*); "Lesestatus" for *reading* |
| A wrong term | *Privatsphäre* on the legal link where the German legal text says **Datenschutz** / **Datenschutzerklärung**; *Daten* for *dates* (now *Lesedaten*, *Datum*); *Definieren* vs *Nachschlagen* in the reader; "Lese-Seite" vs "Leseseite" |
| Glossary | *Feed* sentences use "hat … zu Ende gelesen"; "Kürzlich gelesen"; "Möchte ich lesen" in the member's counts |
| A missing subject | "Konnte nicht geladen werden." alone in an error: now says what |
| Stiff or off-voice | "Bitte um einen neuen" → "Frag nach einem neuen"; "In Bibliothek aufnehmen" → "Zur Bibliothek hinzufügen"; extra "bitte" the English does not have |
| Inconsistent | "Wird gespeichert …" vs "Speichere …": busy labels now use the short *Speichere …*, *Füge hinzu …*, *Ändere …* |
| A typo | "Gescannnt" |
| A bug, not a wording | `genre.stats.row` wrote `{percent} %` where `{percent}` already carries its sign ("40 % %"); fixed |

## What is still open (for you)

- **Glossary decisions D1–D15** in `german-glossary.md` are in force as proposed (with Goodreads' words). A change is one edit in `glossary.json` plus a re-run of the affected keys: delete them from `de.json` and run `pnpm i18n:translate`.
- **Length.** German runs 1.2× the English at the median and 1.7× at the 90th percentile; `pnpm i18n:verify` lists 123 warnings, almost all labels that are longer than the English (e.g. *Nochmal versuchen* 17 characters for *Try again*, *Als abgebrochen markieren* for *Mark as DNF*). None is judged: the acceptance check is a Playwright pass at 390 px (issue #257), which this phase did not run.
- **Not translated here** (outside `en.json`, issue #257 "Outside the bundle"): the Supabase auth emails and the edge-function emails, messages returned by database functions, the PWA manifest and offline page, the legal and imprint pages (`web/app/legal/*` already have German text of their own), and the app's language switch itself (locale registration in `nuxt.config.ts`, detecting the phone's language, the Profile radio, `<html lang>`). `de.json` is complete but nothing loads it yet.
- A second reader of the whole file is still worth an hour: the reviewers read each string beside its English, never on a screen.
