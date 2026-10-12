# German, group B: what a member reads outside the app shell

Group A (#296) put German in the app. This is the rest of issue #257: the mails, the link preview and picture of a shared page, the manifest, the legal text, the kit's lock, and what the app still shows that no message file holds. The name is always written **BetterReads**, alone: never in a compound ("BetterReads-Code"), and no tagline in a mail.

## 1. Which language does a function know?

| Surface | Who asks | Language comes from | Why not the others |
| --- | --- | --- | --- |
| Sign-in code (Supabase Auth) | a signed-out device | the account's `user_metadata.locale` (`de` is German, anything else English); **sign-up** sends it with the request, and the app keeps it in step while signed in (`plugins/locale-sync.client.ts`, `auth.saveLocale`) | Checked on a throwaway stack: Auth ignores `data` sent for an address that already has an account (`.Data` is the stored `user_metadata` only), so a per-request field cannot work for a returning member. The request's `Accept-Language` never reaches the template. The language is a device setting (`utils/locale.ts`), so it is copied to the account, not moved. |
| Invite (`waitlist-invite`) | the **owner** | `private.waitlist.locale`, sent by the app when the visitor joined (`join_waitlist(…, p_locale)`), answered by `owner_waitlist_prepare_invite` | The request is the owner's: her `Accept-Language` says nothing about the recipient, and the recipient's request is days old. A bilingual mail was the alternative; one stored two-letter value is smaller than a mail that is half unreadable. Listed in the privacy notice. |
| Link preview and picture | a crawler, once, for whoever gets the link | `?lang=de` on the link, added by the Share sheet and Copy for a German member (`sharedPath`) | A preview is made once and cached for everyone; only the sender's app knows the sender's language at that moment. No migration. Links made before stay English. |
| Manifest | the browser, at install and update | the request's `Accept-Language` (`functions/manifest.webmanifest.js`) | The only place a browser's language reaches a static file. |
| Contact, feedback, account deletion | | no mail exists: Contact writes a row the owner reads in the app; deleting an account sends nothing | |

Subjects: the sign-in code's is a Go template in `supabase/config.toml` (and the dashboard: docs/SETUP.md), the invite's is in `mail.ts`. Nothing is sent that the member did not ask for, as before.

## 2. Server text the member can see

Audit of the web app and the edge functions (a reading of every `functions.invoke`, every error ref a template prints, every dynamic `t(\`ns.${code}\`)`, and a scan of every template for literal text). **Functions and RPCs return codes, the client maps them to keys; no raw server message is printed anywhere.** Every code set checked has a key in `en.json` and `de.json` (identical key sets). Exceptions, none fixed here:

| What | Where | Is |
| --- | --- | --- |
| The browser's own "Please fill out this field" bubble on the email field | `pages/sign-in.vue`, `sign-up.vue` (`required`, no `novalidate`) | browser/OS language; fix: `novalidate` and `auth.error.email_invalid` |
| Nuxt's built-in 404/500 page | no `app/error.vue` | English library prose; fix: add `app/error.vue` |
| MyMemory's non-200 answers come back as prose in `translatedText` | `data/reader/lookup.ts` → `TranslateSheet.vue` | third party; fix: treat `responseStatus` ≠ 200 as `failed` |
| Release notes ("What's new") | `utils/changelog.ts` from CHANGELOG.md | English only; headings are translated |
| Wiktionary definitions | `DefineSheet.vue` | data (English Wiktionary) |
| `Intl.DisplayNames` in the Translate sheet lists the target in its own language first ("English", not "Englisch") | `TranslateSheet.vue:22` | probably intended |
| The native date picker | `ui/DateRow.vue` | the OS |
| `dnb-lookup`'s `rate_limited` and friends become a generic "unknown" | `data/dnb.ts` | translated, just not specific |
| Genre ids not in the 20 known show the key path | `genre.${id}` without `te()` in four components | data that cannot occur today |
| Regal's own strings (the private layer) | `components/shelf/*` | outside this repository; the German pass saw "not rated" |
| `regal-export` returns prose `errors[]` | `supabase/functions/regal-export` | operator-facing (env problems), the app does not call it |

## 3. Manifest, offline page, previews, legal

- **Manifest.** One static file has no per-language members (the localisation proposal is not implemented by any browser). `name` and `short_name` are the brand. `lang: 'en'` is correct for the built file. What is words: `description` and the three long-press shortcuts. A Pages Function answers a German browser with German ones and `lang: 'de'` (`docs/HOSTING.md`). A member's in-app choice cannot reach it. Not verified on Cloudflare.
- **Offline page.** There is none: `navigateFallback` is the app shell, which is the app and speaks the app's language (the offline strings are keys). The static HTML before the app starts has no visible text and `lang="en"` until the first paint sets `<html lang>`.
- **Picture and preview** (`reading-page-og` labels, `og:title`, `og:description`): German with `?lang=de`, from `utils/previewText.ts`, one table both runtimes import. The German reads "Ada liest", "Liest Piranesi · 12 Bücher in 2026", "Ada hat es mit 4½ Sternen bewertet", the status labels "Liest gerade / Möchte es lesen / Gelesen". Checked by rendering a German page picture.
- **Privacy notice.** English and German have the same 31 blocks and the same lists (Wikidata, Wikipedia, Open Library, Apple, the German National Library with its CC0 catalogue, Goodreads, MyMemory, Wiktionary, Cloudflare, Supabase), BetterReads throughout (the imprint's `libellus.fabkho.dev` and GitHub addresses are real addresses). Two lines are new in both languages and the version moves to 26 October 2026: the account holds the app language (for the sign-in mail), the waitlist entry holds the page's language (for the invite). The DNB line (#307), the Goodreads/Apple lists and the rename were already in both. **The imprint is not shipped yet** (`IMPRINT_ENABLED`); its text is in both languages.

## 4. The lock

`web/.i18n-kit.lock.json` was behind `en.json` for 61 keys: the 35 hand-written strings of #310, #313 and #315 (no record), and 26 whose English changed in the BetterReads rename (German already swapped by hand, so reported stale). They were removed from `de.json` and re-run through the kit (gemini-3.8-flash, the glossary), which wrote the lock; each result was then compared with the hand-written German. The hand-written German stays for 60 keys (the glossary's words, shorter, or the existing voice: "Namen ändern" not "bearbeiten", "Deine Reihenfolge" not "Eigene", "Sortieren: …" to match the Library's pill, "Hinzugefügt" not "Hinzugefügt am"); one is the kit's, `import.coverFill` ("abgefragt" for "asked"). `pnpm i18n:translate --dry-run`: 0 translate, 0 stale. `pnpm i18n:verify`: 0 errors, 126 warnings (lengths, as before). The Gemini key was in the environment; nothing was needed from the owner.

## 5. Read-through, 390 px, light

Ten screens read in German (sign-in, Home top, Book being read, Friends feed, Profile top, Import, and the rest of the pass's 47 screens scanned): the German pass (`e2e/i18n/german-pass.spec.ts`, run on a throwaway stack) finds **no English string of `en.json`** on any screen at 390 or 360, light or dark, and no cut-off German; its only findings are `libellus.test` (the fixture's publisher) in the edition sheet and the known English line at 360 (`profile.figures.usually`). Things a person would still notice:

- **Inconsistent:** Home says "Noch offen" under the reading card, the Book page says "Nicht begonnen" for the same state (`book.progress.none` vs the Home key).
- **Clumsy:** the Profile's library line puts a count before a status name: "1 LESE ICH GERADE · 1 MÖCHTE ICH LESEN".
- **Still English:** Regal's own strings on the shelf (the private layer), the book titles and authors of the member's data, and the Goodreads/Hardcover export instructions (on purpose).
- **The sign-in screen still shows `app.tagline`** ("Die Bücher, die du liest, in aller Ruhe aufbewahrt." / "The books you read, kept quietly.") under the wordmark: the owner said he does not want a tagline in the mails; whether the app keeps it is his call.

## The 20 phrases most worth the owner's eye

| # | Where | German |
| --- | --- | --- |
| 1 | Sign-in mail, subject and title | Dein Anmeldecode für BetterReads |
| 2 | Sign-in mail | Gib diesen Code in der App ein: |
| 3 | Sign-in mail | Der Code gilt eine Stunde und kann einmal verwendet werden. |
| 4 | Sign-in mail footer | Wenn du das nicht warst, kannst du diese E-Mail ignorieren. |
| 5 | Invite mail | Du hast um eine Einladung zu BetterReads gebeten. Hier ist dein Code: |
| 6 | Invite mail | Er gilt einmal, bis zum 27. Oktober 2026. |
| 7 | Invite mail | Öffne BetterReads, wähle **Registrieren** und gib deine E-Mail-Adresse und diesen Code ein. |
| 8 | Invite mail footer | Du bekommst diese E-Mail, weil du auf einer Leseseite um eine Einladung gebeten hast. Wir haben deine Adresse nur dafür verwendet. |
| 9 | Link preview of a page | Ada liest · Liest Piranesi · 12 Bücher in 2026 |
| 10 | Link preview of a card | Ada hat es mit 4½ Sternen bewertet · *Titel* von *Autor* |
| 11 | Picture of a card | Liest gerade / Möchte es lesen / Gelesen |
| 12 | Picture of a page, nothing to say | Ein Regal zum Stöbern |
| 13 | Manifest description | Deine Bücher: was du lesen möchtest, was du gerade liest und was du gelesen hast. |
| 14 | Android long-press shortcuts | Suche · Fortschritt aktualisieren · Bibliothek |
| 15 | Privacy, account | … die Sprache, die du in der App nutzt (Deutsch oder Englisch, damit dein Anmeldecode in ihr ankommt) … |
| 16 | Privacy, waitlist | … in welcher Sprache die Seite war (Deutsch oder Englisch, damit die Einladung in ihr geschrieben ist) … |
| 17 | Collection sort hint | Vorübergehend sortiert. Wähle „Deine Reihenfolge“, um Bücher wieder zu verschieben. |
| 18 | Collection, add from search | Ein Buch, das noch nicht in deiner Bibliothek ist, kommt auf „Möchte ich lesen“ und in „{name}“. |
| 19 | Import, second pass | {done} von {total} Büchern werden erneut gesucht · Seit einer Weile antwortet nichts. Du kannst mit dem Gefundenen weitermachen. |
| 20 | Import, covers | Fehlende Cover werden gesucht: {done} von {total} abgefragt, {found} gefunden. Das läuft im Hintergrund weiter. |
