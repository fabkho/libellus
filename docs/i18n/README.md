# Translating Libellus (English → German)

Libellus has one source language, English: `web/i18n/locales/en.json`. German (`de.json`, informal *du*) is produced by **the-i18n-kit** ([fabkho/the-i18n-kit](https://github.com/fabkho/the-i18n-kit), `@the-i18n-kit/cli`) calling the **Gemini API**, then read by a person. Issue #257 has the plan; this folder is how the tooling works.

| File | What it is |
| --- | --- |
| `web/i18n-kit.config.ts` | Wires the kit to Libellus: locale folder, the two locales, the context below. No secrets. |
| `web/i18n/kit/ai-context.md` | The brief the model gets: voice, length, quotes, placeholders, plurals, gender. Edit it to change how German sounds. |
| `web/i18n/kit/glossary.json` | Terms never translated, and the German word for each domain term. Edit it to change a word everywhere. |
| `web/i18n/kit/examples.json` | A few approved English → German pairs the model imitates. |
| `web/scripts/i18n/run.mjs` | `pnpm i18n:translate` / `i18n:verify` / `i18n:status`: the kit plus the fixes and checks Libellus needs. |
| `web/scripts/i18n/verify.mjs` | The checks: keys, placeholders, plural forms, links, English left over, length, quotes, gender signs. |
| `web/tests/i18n-parity.test.ts` | The Vitest parity test (fails when `de.json` and `en.json` drift). |
| `docs/i18n/german-glossary.md` | The glossary decisions, as a table to correct. |
| `docs/i18n/german-sample.md` | The dry run: 49 strings, English and German side by side, three models compared. |

## Setup (once per machine)

The model's key is read from the environment and from nowhere else:

```sh
export GEMINI_API_KEY=…        # in your shell profile, never in a file of this repo
pnpm install                   # in web/
```

Nothing else is installed: `pnpm i18n:*` runs the kit with `npx @the-i18n-kit/cli@8.3.0` (pinned in `web/scripts/i18n/run.mjs`; bump it on purpose, read the kit's changelog, run `pnpm i18n:sample`). The key is never put on a command line, in a config file, in a log or in the lockfile. The only network call is to `generativelanguage.googleapis.com`.

## Add a string

1. Add the key to `web/i18n/locales/en.json` (same rules as today: one key per string, `{named}` placeholders, `a | b` for plurals, nothing is ever concatenated).
2. Run `pnpm i18n:translate` (in `web/`). It asks the model for **only the keys `de.json` lacks**, writes them into `de.json` in `en.json`'s order, then checks them. A fraction of a cent per key.
3. Read the diff of `de.json` (below). Fix a word by hand in `de.json`; a hand-edit is never overwritten.
4. Commit `en.json`, `de.json` and `web/.i18n-kit.lock.json` together.

```sh
pnpm i18n:translate                    # every key missing from de.json
pnpm i18n:translate --dry-run          # list them, call nothing, write nothing
pnpm i18n:translate --keys a.b,c.d.e   # only these keys, if they are missing
pnpm i18n:translate --overwrite-stale  # also redo keys whose English changed since (see below)
pnpm i18n:translate --model gemini-3.5-flash-lite   # another model (or export I18N_MODEL)
pnpm i18n:verify                       # check de.json against en.json, no network
pnpm i18n:status                       # coverage as the kit counts it
```

### When the English of an existing key changes

The kit records, in `web/.i18n-kit.lock.json`, a hash of the English each German string was made from. If you reword `en.json`, the next run **reports the key as stale and leaves the German alone** (it may still be right):

```
model gemini-3.8-flash: 0 translated, 0 failed, 0 skipped, 1 stale
  stale  common.cancel: the English changed since this was translated; kept as it is (--overwrite-stale redoes it)
```

Retranslate it with `pnpm i18n:translate --overwrite-stale` (all stale keys), or delete the key from `de.json` and run again. A key you edited by hand in German and that has no record is never called stale.

### What a run does, in order

1. `de.json` is created as `{}` if it does not exist (the kit finds a target file only if it exists; without one it reports success and writes nothing).
2. The kit finds the keys missing (or empty) in `de.json`, batches them (50 per request), and sends each batch with the brief, the glossary and the examples to Gemini at temperature 0 with the least thinking the model accepts.
3. It validates every returned string against its source (`{placeholders}` per plural form, number of `|` forms, `@:` links). A string that fails is **not written**; it is listed as `failed` with a reason and the run exits non-zero. Re-run to retry.
4. `de.json` is rewritten in the key order and 2-space indent of `en.json` (the kit writes keys alphabetically with tabs, which would make the diff unreadable).
5. `scripts/i18n/verify.mjs` checks the result and prints warnings for a person to look at.

## Review the result

```sh
git diff web/i18n/locales/de.json          # what the model wrote, key order = en.json order
pnpm i18n:verify                           # errors fail; warnings are for you
```

What to look for, in this order:

1. **Errors** (`pnpm i18n:verify` exits 1): a missing, extra or empty key, a changed `{placeholder}`, a different number of plural forms, a changed `@:link` or `{'@'}`. The app would break; fix or re-run the key.
2. **Warnings**: `english` / `unchanged` (English left over), `length` (a label 1.6× longer or a sentence 1.7×: check it at 390 px), `gender` (a sign such as *Freund:innen*), `sie` (formal address), `quotes` (straight quotes), `full-stop`, `symbols`.
3. **Voice**: du; the glossary word; short; a sentence that sounds like software gets rewritten. Examples of what I changed in the sample: `docs/i18n/german-sample.md`.
4. **Context**: a string is translated without seeing the screen. Words with two meanings (*Read*, *Share*, *Copy*, *Back*, *Close*) are the usual slips; add a line to `glossary.json` rather than fixing each use.

When the same fix appears twice, put it in `glossary.json` (a word) or `ai-context.md` (a rule) or `examples.json` (a pair), so the next run is right.

## Parity test

`web/tests/i18n-parity.test.ts` runs with the data-layer suite (`pnpm test`). Once `de.json` exists it fails on any of: a key in `en.json` missing or empty in `de.json`, a key in `de.json` that `en.json` lacks, a `{placeholder}` that differs (per plural form), a different number of `|` forms, a changed `@:link`, a lost `{'@'}`. The same checks are `pnpm i18n:verify`. A message for a missing key looks like:

```
AssertionError: expected [ 'missing social.requested: not in de.json', … ] to deeply equal []
```

A new feature's strings may land in `en.json` before they are translated only if the key is named in `ALLOW_UNTRANSLATED` in that test file (empty today, and the goal). Until `de.json` exists the test only checks itself (its ten cases on a made-up pair), so it passes on today's `main`.

## Cost

Model default: **`gemini-3.8-flash`** (`DEFAULT_MODEL` in `run.mjs`). Prices are from <https://ai.google.dev/gemini-api/docs/pricing> (paid tier, standard, per million tokens, read 2026-10-11):

| Model | Input | Output (incl. thinking) | Note |
| --- | --- | --- | --- |
| `gemini-3.8-flash` | $0.75 until 2026-12-31, then $1.50 | $3.75, then $7.50 | default; best German of the three tested |
| `gemini-3.5-flash-lite` | $0.30 | $2.50 | about half the price, more literal |
| `gemini-3.1-flash-lite` | $0.25 | $1.50 | spends about twice its answer in hidden thinking tokens: not cheaper in practice |
| `gemini-2.5-flash-lite` | $0.10 | $0.40 | **not available to this key** (HTTP 404, "no longer available to new users") |

Measured with the Gemini `countTokens` endpoint and the usage the API reports (a pass-through, `scripts/i18n/usage-proxy.mjs`, adds up the real tokens of a run): `en.json` is 68,573 bytes = **20,500 tokens** as a file; the flat key→value JSON the kit sends is **18,669 tokens**. Each request carries about 3,700 tokens of brief, glossary and examples; the answer is about 1.25× the tokens sent (German, plus the echoed keys).

| Run | Requests | Input tokens | Output tokens | `gemini-3.8-flash` | `gemini-3.5-flash-lite` |
| --- | --- | --- | --- | --- | --- |
| **Full translation** (1,446 keys) | 29 | ≈ 126,000 | ≈ 23,300 | **≈ $0.18** (≈ $0.36 from 2027) | ≈ $0.10 |
| Re-run for 10 new keys | 1 | ≈ 3,900 | ≈ 230 | ≈ $0.004 | ≈ $0.002 |
| Re-run for 50 new keys | 1 | ≈ 4,600 | ≈ 1,150 | ≈ $0.008 | ≈ $0.004 |
| Re-run for 200 new keys | 4 | ≈ 18,400 | ≈ 4,600 | ≈ $0.03 | ≈ $0.02 |

The full run is an estimate from the sample's measured rates (49 keys: 4,599 prompt tokens, 1,123 answer tokens, no thinking); the real run's usage is recorded the same way. On the free tier Google may use the prompts to improve its products ("Used to improve our products: Yes" on the price page); the strings are public in this repository anyway, but check which tier the key is on before sending anything private.

## Dry run (sample)

```sh
node scripts/i18n/sample.mjs --models gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite
```

Translates the 49 strings in `scripts/i18n/sample-keys.json` into `web/.i18n-sample/<model>/` (git-ignored), never into `i18n/locales`, checks them and renders `docs/i18n/german-sample.md`, with `scripts/i18n/sample-notes.md` appended. Use it after a kit upgrade, a model change or a larger edit of `ai-context.md`.

## Known limits of the tooling

- **A new locale file must exist** before the kit writes into it (kit 8.3.0, generic adapter). `run.mjs` creates `{}` for you. Worth an issue upstream; nothing was changed in the kit.
- **The kit writes keys alphabetically with tabs.** `run.mjs` puts `de.json` back in `en.json`'s order.
- **The Nuxt adapter is not used** (it boots the whole app and wants its Supabase env to read one folder). The kit is told where the files are (`localeDirs`, `framework: 'generic'`).
- **Not deterministic**: a second run on the same key can word it differently. The kit never overwrites an existing translation, so this only matters when you redo a key.
- **The model sees one string, not the screen.** See "Review" above.
- `{'@'}` (vue-i18n literal) is not checked by the kit; `verify.mjs` checks it. `<i18n-t>` messages are plain strings with a named slot: the kit protects `{slot}` like any placeholder.
