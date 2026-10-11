# German glossary: decisions for the owner

Phase 1 of issue #257. These are the choices the translation will follow. **Correct them here or in `web/i18n/kit/glossary.json` before phase 2**: the model uses `glossary.json` word for word, and a changed word costs nothing now and a review pass later. Voice and rules: `web/i18n/kit/ai-context.md`. Source of the English vocabulary: `en.json` (1,446 keys) and `CONTEXT.md`.

## Decisions I need you to confirm

| # | Question | My proposal | Why | Alternatives |
| --- | --- | --- | --- | --- |
| D1 | **Library** (tab, "your Library") | **Bibliothek** | The word everyone knows; 10 letters on a tab are fine. | *Bücher*, *Meine Bücher* |
| D2 | **Want to read** (status, list, feed line) | **Will ich lesen** | Reads as a sentence in the feed ("hat X zu „Will ich lesen“ hinzugefügt"); close to how German book apps word it. 14 characters. | *Leseliste* (short, but a list, not a status), *Möchte ich lesen* |
| D3 | **Currently reading** / **Reading** | **Lese ich gerade** (status, Home row); **Lese ich** (the short segment next to Want to read and Finished) | Keeps the "ich" rhythm of D2 and D4. The segment needs the short form: three long chips do not fit at 390 px. | *Aktuell*, *Am Lesen* |
| D4 | **Finished** / **DNF** | **Gelesen** / **Abgebrochen** | "Gelesen" is the status; the verb "finish" is *beenden* / *zu Ende lesen*. "DNF" is Anglo book-bubble slang; *Abgebrochen* is plain. | *Fertig gelesen*, *DNF* kept |
| D5 | **Circle** ("Your circle") | **Kreis** ("Dein Kreis") | *Freundeskreis* is 13 letters and says "friends" where the app means "the people you follow". | *Freundeskreis*, *Leute* |
| D6 | **Follow** vocabulary | **Follower** (invariable), **Folgen**, **Folge-Link**, **Folgeanfrage**, **Privates Konto** / **Öffentliches Konto** | "Follower" is what German users already say; *Abonnenten* is wrong for people. | *Abonnent*, *Anfrage zum Folgen* |
| D7 | **Home**, **Search** (tabs) | **Start**, **Suche** | As iOS in German. | *Home* kept |
| D8 | **Try again** (91 occurrences of "again", 66 of them "Try again") | **Nochmal versuchen** | Short and informal. | *Erneut versuchen* (formal-ish, longer) |
| D9 | **Shelf** ("Your shelf") | **Regal** ("Dein Regal") | And "Regal" the feature name stays "Regal", which is already German for shelf. | |
| D10 | **Edition** | **Ausgabe** | The bookseller's word. | |
| D11 | **Author** | **Autor** / **Autoren** (no gender sign, anywhere) | A sign in the middle of a calm UI is noise, and the same rule would have to apply to every person noun. The sample showed the model writes *Freund:innen* and *Jede:r* unprompted: the checker flags them, so the rule holds. | *Autor:in* / *Autor:innen* (then also *Freund:innen*, *Leser:innen*) |
| D12 | **A read** (one reading of a book, `history.*`) | **Lektüre** ("Erste Lektüre", "2 Lektüren") | Literate, short. | *Lesedurchgang* (clumsy), *Mal gelesen* |
| D13 | **Placeholder cover** / **Cover** | **Platzhalter-Cover** / **Cover** | German book apps say "Cover". | *Umschlag* |
| D14 | **Hardcover, Paperback, Ebook, Audiobook** | **Hardcover, Taschenbuch, E-Book, Hörbuch** | | |
| D15 | **Sign in / up / out**, **Account**, **Profile** | **Anmelden / Registrieren / Abmelden**, **Konto**, **Profil** | | |

Kept as written (never translated): Libellus, Goodreads, Hardcover (the app), StoryGraph, LibraryThing, Apple Books, Open Library, Wikipedia, Wiktionary, MyMemory, Supabase, **Regal**, ISBN, EPUB, CSV, PDF, URL, CC BY-SA. Menu names inside another service stay English because that service is English ("My Books → Import and export → Export library").

Other rules decided in `ai-context.md` (read them once): informal *du* always; German quotes „…“; the status or button name inside a sentence goes in „…“ (zu „Will ich lesen“ hinzugefügt); `{placeholders}`, `|` plural forms and `@:links` untouched; every label as short as the language allows (German is about 12-15 % longer on this sample, about 50 % at the 90th percentile).

## The 40 most frequent domain words in en.json

Counts are occurrences in the values of `en.json` (plural and inflected forms together, `{placeholders}` removed). "→" is the proposal; the ones with a decision above point to it.

| # | English | Count | German | Note |
| --- | --- | --- | --- | --- |
| 1 | book(s) | 179 | Buch / Bücher | |
| 2 | again (mostly "Try again") | 91 | Nochmal versuchen | D8 |
| 3 | read / reads | 86 | lesen / gelesen; noun: Lektüre | D12 |
| 4 | page(s) | 74 | Seite / Seiten | "p." = "S." |
| 5 | add / added | 66 | Hinzufügen / hinzugefügt | button: *Hinzufügen* |
| 6 | link(s) | 54 | Link / Links | loan word kept |
| 7 | reading | 53 | Lese ich gerade / Lese ich | D3 |
| 8 | edition(s) | 48 | Ausgabe / Ausgaben | D10 |
| 9 | Library | 46 | Bibliothek | D1 |
| 10 | save / saved | 40 | Speichern / gespeichert | |
| 11 | follow / follower | 40 | Folgen / Follower | D6 |
| 12 | finish / finished | 39 | beenden; status Gelesen | D4 |
| 13 | delete / remove | 39 | Löschen / Entfernen | *Löschen* destroys, *Entfernen* takes it off a list or a Collection |
| 14 | back | 37 | Zurück | |
| 15 | start / started | 37 | Starten / begonnen | |
| 16 | copy / copied | 36 | Kopieren / kopiert | a copy of a book: *Exemplar* |
| 17 | file(s) | 35 | Datei / Dateien | |
| 18 | ebook(s) | 32 | E-Book / E-Books | D14 |
| 19 | collection(s) | 32 | Sammlung / Sammlungen | |
| 20 | invite(s) | 30 | Einladung / Einladungscode | |
| 21 | day(s) | 30 | Tag / Tage | |
| 22 | rating(s) | 28 | Bewertung / Bewertungen | |
| 23 | share / shared | 27 | Teilen / geteilt | |
| 24 | ISBN | 25 | ISBN | kept |
| 25 | offline | 24 | Offline | "Du bist offline." |
| 26 | code(s) | 24 | Code / Codes | |
| 27 | review(s) | 24 | Rezension / Rezensionen | |
| 28 | want (to read) | 22 | Will ich lesen | D2 |
| 29 | sign in / up / out | 22 | Anmelden / Registrieren / Abmelden | D15 |
| 30 | hardcover, paperback, audiobook | 22 | Hardcover, Taschenbuch, Hörbuch | D14 |
| 31 | device | 21 | Gerät | |
| 32 | export | 21 | Export / exportieren | |
| 33 | shelf | 20 | Regal | D9 |
| 34 | series | 19 | Reihe / Reihen | |
| 35 | search | 19 | Suche / Suchen | D7 |
| 36 | year | 18 | Jahr / Jahre | "Year in review" = *Jahresrückblick* |
| 37 | author(s) | 18 | Autor / Autoren | D11 |
| 38 | email | 18 | E-Mail | |
| 39 | sync | 18 | Synchronisieren / synchronisiert | "Syncing…" = *Synchronisiere …* |
| 40 | edit / change | 17 | Bearbeiten / Ändern | *Ausgabe ändern*, *Genres bearbeiten* |

Next most frequent, also in `glossary.json`: import (16, *Import*), photo (15, *Foto*), title (15, *Titel*), account (13, *Konto*), connection (13, *Verbindung*), progress (10, *Fortschritt*), genre (10, *Genre*), cover (8), privacy (8, *Privatsphäre*), member (8, *Mitglied*), profile (8, *Profil*), DNF (7), circle (5, D5), waitlist (4, *Warteliste*), Home Screen (3, *Home-Bildschirm*).
