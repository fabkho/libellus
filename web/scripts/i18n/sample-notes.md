## What I would change (reviewer's notes)

Verdict: **usable first draft, not final copy.** All 49 strings pass every automatic check (keys, `{placeholders}` per plural form, `|` forms, `@:` links, `{'@'}`), the voice is du throughout and the glossary words are used. A human review pass is still needed, as the issue says: about one string in six has a wording I would change.

Wording I would change in the `gemini-3.8-flash` column above:

- `sync.waiting`: "wartet auf **Empfang**" is wrong (a signal, not a connection); "wartet auf eine Verbindung" (the lite models got it right). It also dropped "made on this device". Of the three models only `3.8-flash` produced this slip, so a better model is no guarantee.
- `auth.error.invite_gone`: "Bitte um einen neuen." reads as "please request one" at best; "Frag nach einem neuen." is clearer. Two of three models wrote "Bitte um …"; the gloss in the glossary does not catch it. Candidate for an example in `examples.json`.
- `ownEdition.title.isbn`: "Deine Ausgabe finden" is fine; "Finde deine Ausgabe" is closer to the source's voice.
- `library.error.ended_before_started`: "Lesebeginn" adds a word the source does not use; "Das ist vor dem Start. Wähle den Starttag oder einen späteren." keeps "start day".
- `feed.emptyTitle` (`Lesen macht mit ein, zwei Freunden mehr Freude.`) is a good, natural line, but only on this run: earlier runs gave "Lesen ist schöner mit Freunden." Same prompt, temperature 0, different text: the model is not fully deterministic. That is harmless for the workflow (an existing translation is never overwritten), but it means a second run is not a reproduction.
- `home.readInLabel`: "Gelesen 2026: 5" drops "in"; "Gelesen in {year}: {count}" is what I would write (another run did).
- `home.installHint.text`: "auf dem ganzen Bildschirm" for "full screen" is stilted; "im Vollbild" is what the iOS manual says. The quotes „Teilen“ and „Zum Home-Bildschirm“ are what I wanted (the quoting rule in `ai-context.md` works).
- `privacy.goPublicText`: "wird jetzt zum Follower" is correct but cool; fine.
- `shelf.card.allLabel`: "Alle 1 Buch zeigen" is stiff for one book; plural form 1 only shows at count 1, "Zeige das Buch in deinem Regal" would be nicer. Low priority.
- `feed.batchFinished` ("hat 3 Bücher zu Ende gelesen") is ×1.8 the English: acceptable in a feed row, but "hat 3 Bücher beendet" is shorter and in my glossary. The glossary says "beenden" for the verb; the model prefers "zu Ende gelesen" 2:1. Decide once and say so in the glossary.
- `import.howTo.goodreads` keeps "My Books → Import and export → Export library" in English on purpose (Goodreads' site is English). The checker lists it as "looks English"; it is the one expected hit.

What the sample showed about the tool:

- The kit **protects what matters**: it validates every returned value against the source (placeholders, plural forms, `@:` links) and marks a key `failed` instead of writing it. None failed here; nothing was repaired by hand.
- It does **not** check `{'@'}` (vue-i18n literal), gender signs, English left over, length or quotation marks: `scripts/i18n/verify.mjs` does, and runs at the end of every `pnpm i18n:translate`. The model did write "Freund:innen" and "Jede:r" in earlier runs despite the rule; the checker flags those, and the rule in `ai-context.md` now names them.
- `gemini-3.1-flash-lite` spends about twice its answer in hidden thinking tokens (2,329 here), billed as output: it is not cheaper than `3.8-flash` in practice. `3.8-flash` and `3.5-flash-lite` spend none.
- `gemini-2.5-flash-lite` (the cheapest on the price page) answers HTTP 404 for this key: "no longer available to new users". Not an option.
- Quality order on these 15 comparison strings, my judgement: `3.8-flash` ≥ `3.1-flash-lite` > `3.5-flash-lite`. The lite models are more literal and wordier (`photo.private`: "Du und die Mitglieder, mit denen du verbunden bist"; `3.5-flash-lite` also wrote "{percent} %" in `genre.stats.row`, where `{percent}` is already formatted with its sign by `Intl`, so the app would show "40 % %"; the checker's symbol test caught it). All three would pass the automatic checks and need the same review.

Decisions this sample needs from the owner are in `docs/i18n/german-glossary.md` (the table at the top).
