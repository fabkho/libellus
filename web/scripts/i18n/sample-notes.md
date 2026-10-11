## What I would change (reviewer's notes)

Verdict: **usable first draft, not final copy.** All 49 strings pass every automatic check (keys, `{placeholders}` per plural form, `|` forms, `@:` links, `{'@'}`), the voice is du throughout and the glossary words are used. A human review pass is still needed, as the issue says: about one string in five has a wording I would change.

Wording I would change in the `gemini-3.8-flash` column above:

- `sync.waiting`: "wartet auf **Empfang**" is wrong (a signal, not a connection): "wartet auf eine Verbindung" (both lite models got it right). Two runs in a row, so it is the model's habit, not noise. It also dropped "made on this device" in one run.
- `auth.error.invite_gone`: "Bitte um einen neuen." reads as "please request one" at best; "Frag nach einem neuen." is clearer. Two of three models wrote "Bitte um …" in every run. Candidate for an entry in `examples.json`.
- `library.error.ended_before_started`: "Wähle den ersten Tag oder später" is vague; "Wähle den Starttag oder einen späteren." keeps "start day".
- `photo.private`: "Sichtbar für dich und deine **Kontakte**" swaps "members" for a word the app does not use (the glossary says *Mitglied*), and it dropped "while your account is public" into a clause that changes who sees it. The lite models stayed closer, wordier but correct.
- `home.readInLabel`: "Gelesen 2026: 5" drops "in"; "Gelesen in {year}: {count}" is what I would write (the other model did).
- `home.installHint.text`: "Öffnet sich als App, im Vollbild." drops the subject "Es"; "Es öffnet sich wie eine App im Vollbild." The quotes „Teilen“ and „Zum Home-Bildschirm“ are what I wanted (the quoting rule in `ai-context.md` works).
- `shelf.card.allLabel`: "Alle 1 Buch zeigen" is stiff for one book (it only shows at count 1); low priority.
- `feed.emptyTitle`: "Lesen ist schöner mit Freunden." is good. In other runs the same prompt at temperature 0 gave other good lines ("Lesen macht mit ein, zwei Freunden mehr Freude."): the model is **not fully deterministic**. Harmless for the workflow (an existing translation is never overwritten), but a second run is not a reproduction.
- `privacy.goPublicText`: "Alle mit deinem Link können dir ohne Anfrage folgen" is natural; the lite models say "Jedes Mitglied", closer to the English.
- `import.howTo.goodreads` keeps "My Books → Import and export → Export library" in English on purpose (Goodreads' site is English). The checker lists it as "looks English"; it is the one expected hit.
- `friends.want`, `status.want_to_read`: **Möchte ich lesen**, the wording Goodreads' German shelf has (see `german-glossary.md`), in all three models. The English says "Your friends".

What the sample showed about the tool:

- The kit **protects what matters**: it validates every returned value against the source (placeholders, plural forms, `@:` links) and marks a key `failed` instead of writing it. None failed here; nothing was repaired by hand.
- It does **not** check `{'@'}` (vue-i18n literal), gender signs, English left over, length or quotation marks: `scripts/i18n/verify.mjs` does, and runs at the end of every `pnpm i18n:translate`. The model did write "Freund:innen" and "Jede:r" in earlier runs despite the rule; the checker flags those, and the rule in `ai-context.md` now names them.
- `gemini-3.1-flash-lite` spends about twice its answer in hidden thinking tokens (about 2,400 here), billed as output: it is not cheaper than `3.8-flash` in practice. `3.8-flash` and `3.5-flash-lite` spend none.
- `gemini-2.5-flash-lite` (the cheapest on the price page) answers HTTP 404 for this key: "no longer available to new users". Not an option.
- Quality order on these 15 comparison strings, my judgement: `3.8-flash` ≥ `3.1-flash-lite` > `3.5-flash-lite`. The lite models are more literal and wordier (`photo.private`: "Du und die Mitglieder, mit denen du verbunden bist"; `3.5-flash-lite` also wrote "{percent} %" in `genre.stats.row`, where `{percent}` is already formatted with its sign by `Intl`, so the app would show "40 % %"; the checker's symbol test caught it). In the last run `3.5-flash-lite` also left one key out (`sync.waiting`): the kit reports an omitted key as failed and writes nothing for it, and the next run fills it, which is the protection working. Otherwise all three pass the automatic checks and need the same review.

Decisions this sample needs from the owner are in `docs/i18n/german-glossary.md` (the table at the top).
