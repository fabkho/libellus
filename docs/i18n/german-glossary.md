# German glossary: decisions for the owner

Phase 1 of issue #257. These are the choices the translation will follow. **Correct them here or in `web/i18n/kit/glossary.json` before phase 2**: the model uses `glossary.json` word for word, and a changed word costs nothing now and a review pass later. Voice and rules: `web/i18n/kit/ai-context.md`. Source of the English vocabulary: `en.json` (1,446 keys) and `CONTEXT.md`.

## Decisions I need you to confirm

| # | Question | My proposal | Why | Alternatives |
| --- | --- | --- | --- | --- |
| D1 | **Library** (tab, "your Library") | **Bibliothek** | The word everyone knows; 10 letters on a tab are fine. | *Bücher*, *Meine Bücher* |
| D2 | **Want to read** (status, list, feed line) | **Möchte ich lesen** | Goodreads' German shelf name (see below). Reads as a sentence in the feed ("hat X zu „Möchte ich lesen“ hinzugefügt"). 16 characters. | *Will ich lesen*, *Leseliste* |
| D3 | **Currently reading** / **Reading** | **Lese ich gerade** (status, Home row; Goodreads' shelf name); **Lese ich** (the short segment next to Want to read and Finished) | Same rhythm as D2 and D4. The segment needs the short form: three long chips do not fit at 390 px. | *Aktuell*, *Am Lesen* |
| D4 | **Finished** / **DNF** | **Gelesen** (Goodreads' shelf name) / **Abgebrochen** | "Gelesen" is the status; the verb "finish" is *beenden* / *zu Ende lesen*. Goodreads has a "Did Not Finish" shelf but no German name for it that I could find; *Abgebrochen* is plain. | *Fertig gelesen*, *DNF* kept |
| D5 | **Friends** (was "Circle"; the English now says "Your friends" on Home, the feed and Profile) | **Freunde** ("Deine Freunde") | Goodreads' German word for the people you follow; the Profile section was already "Friends". Generic plural, no gender sign. | *Freundeskreis*, *Kreis* |
| D6 | **Follow** vocabulary | **Follower** (invariable), **Folgen** (Goodreads: "Autor folgen"), **Folge-Link**, **Folgeanfrage**, **Privates Konto** / **Öffentliches Konto** | "Follower" is what German users already say; *Abonnenten* is wrong for people. Goodreads has no follow-link or private-account wording. | *Abonnent*, *Anfrage zum Folgen* |
| D7 | **Home**, **Search** (tabs) | **Startseite** (Goodreads' "Startseite"), **Suche** | Follows Goodreads. 10 characters on a tab, the same as *Bibliothek*. | *Start* (shorter, as iOS), *Home* kept |
| D8 | **Try again** (91 occurrences of "again", 66 of them "Try again") | **Nochmal versuchen** | Short and informal. | *Erneut versuchen* (formal-ish, longer) |
| D9 | **Shelf** ("Your shelf") | **Regal** ("Dein Regal") | And "Regal" the feature name stays "Regal", which is already German for shelf. | |
| D10 | **Edition** | **Ausgabe** | The bookseller's word. | |
| D11 | **Author** | **Autor** / **Autoren** (no gender sign, anywhere) | A sign in the middle of a calm UI is noise, and the same rule would have to apply to every person noun. The sample showed the model writes *Freund:innen* and *Jede:r* unprompted: the checker flags them, so the rule holds. | *Autor:in* / *Autor:innen* (then also *Freund:innen*, *Leser:innen*) |
| D12 | **A read** (one reading of a book, `history.*`) | **Lektüre** ("Erste Lektüre", "2 Lektüren") | Literate, short. | *Lesedurchgang* (clumsy), *Mal gelesen* |
| D13 | **Placeholder cover** / **Cover** | **Platzhalter-Cover** / **Cover** | German book apps say "Cover". | *Umschlag* |
| D14 | **Hardcover, Paperback, Ebook, Audiobook** | **Hardcover, Taschenbuch, E-Book, Hörbuch** | | |
| D15 | **Sign in / up / out**, **Account**, **Profile** | **Anmelden / Registrieren / Abmelden**, **Konto**, **Profil** | | |

## Checked against Goodreads in German

Goodreads has **no official German interface**: goodreads.com and its apps are English-only (a German user reads "Want to Read", "Currently Reading", "Read"). The German words below are what German sources use for Goodreads' own screens: the German wikiHow guide ("Der ultimative Goodreads-Leitfaden", <https://de.wikihow.com/Goodreads-nutzen>, which gives each English label with its German one), the German Google Play and App Store listings (<https://play.google.com/store/apps/details?hl=de&id=com.goodreads>), and German articles and import guides (<https://www.epubli.com/wissen/goodreads-fuer-autoren>, <https://linkflare.io/de/hilfe/importieren/>). Where they agree, the glossary uses them; where Goodreads has no word, it says so.

| Goodreads (English) | German in those sources | Libellus glossary now | Changed? |
| --- | --- | --- | --- |
| Want to Read (shelf) | **Möchte ich lesen** (wikiHow, epubli, Linkflare; the Play listing's machine text says „Willst du lesen“-Regal) | Möchte ich lesen | **yes** (was *Will ich lesen*) |
| Currently Reading | **Lese ich gerade** | Lese ich gerade | no |
| Read | **Gelesen** | Gelesen | no |
| Did Not Finish | no German name found | Abgebrochen | no (my wording) |
| Shelf / Bookshelves | **Regal** / **Bücherregal(e)** | Regal | no |
| Friends | **Freunde** | Freunde (was "Circle" → *Kreis*) | **yes** |
| Follow Author | **Autor folgen** | Folgen | no |
| Rate / Rating | **bewerten** / **Bewertung** | Bewertung | no |
| Review | **Rezension** | Rezension | no |
| Edition | **Ausgabe** ("die Ausgabe der Bücher ändern") | Ausgabe | no |
| Genres | **Genres** | Genre | no |
| Home | **Startseite** | Startseite | **yes** (was *Start*) |
| My Books | **Meine Bücher** | Bibliothek | no: Libellus' English is "Library", not "My Books"; *Bibliothek* is its direct word. Change it if you want *Meine Bücher* (D1). |
| Reading Challenge | **Lese-Challenge** | not used in the app | |
| Status update | **Statusaktualisierung** | "Update progress" = *Fortschritt aktualisieren* | no |

The Goodreads export instructions in `import.howTo.goodreads` stay in English on purpose: Goodreads' menus are English.

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
| 28 | want (to read) | 22 | Möchte ich lesen | D2 |
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

Next most frequent, also in `glossary.json`: import (16, *Import*), photo (15, *Foto*), title (15, *Titel*), account (13, *Konto*), connection (13, *Verbindung*), progress (10, *Fortschritt*), genre (10, *Genre*), cover (8), privacy (8, *Privatsphäre*), member (8, *Mitglied*), profile (8, *Profil*), DNF (7), circle (5, now "friends", D5), waitlist (4, *Warteliste*), Home Screen (3, *Home-Bildschirm*).
