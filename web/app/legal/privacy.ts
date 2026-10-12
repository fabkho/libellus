import { IMPRINT_ENABLED } from './config'
import { EMAIL_LINK, PLACEHOLDER as X } from './placeholders'
import type { LegalDocument } from './types'

/**
 * The privacy notice (Datenschutzerklärung). Written against what the app does (README "Privacy",
 * docs/OPERATIONS.md, docs/HOSTING.md, docs/THIRD-PARTY.md, supabase/); when the app starts or stops
 * doing something with data, this changes with it, with a new version date (docs/legal-checklist.md).
 */
export const PRIVACY: LegalDocument = {
  en: {
    title: 'Privacy notice',
    lead: 'BetterReads is a small book-tracking app, run as an invite-only beta. This notice says what it does with your data, who else is involved, and what you can do about it.',
    version: 'Version: 28 October 2026',
    sections: [
      {
        id: 'responsible',
        heading: 'Who is responsible',
        blocks: [
          { p: 'Responsible under the GDPR is:' },
          { lines: ['Fabian Kirchhoff', ...(IMPRINT_ENABLED ? [X.address] : []), `Email: ${EMAIL_LINK}`] },
          { p: 'I run BetterReads alone, as a private, non-commercial project. There is no data protection officer; none is required. Members can also write to me through Contact in their Profile.' + (IMPRINT_ENABLED ? ' The [imprint](/imprint) has the same details.' : '') },
        ],
      },
      {
        id: 'data',
        heading: 'What data I process, and why',
        blocks: [
          { p: 'Only what the app needs. What is optional says so.' },
          {
            ul: [
              '**Your account.** Your email address (to send you sign-in codes and to tell accounts apart), the invite code you signed up with, the language you use in the app (German or English, so that your sign-in code arrives in it), and when the account was made. There is no password: you sign in with a six-digit code sent by email. Supabase Auth also keeps technical details of your sign-ins, such as the time, your IP address and your browser, to secure sessions.',
              '**Your name and photo (optional).** A name you choose and a profile photo. The photo is cut square and shrunk on your device before it is uploaded to a private storage space, and is shown only to people who may see your profile.',
              '**Links to your other profiles (optional).** If you add them: a handle or ID for each of Goodreads, Reado, YouTube, Instagram and TikTok, never a free link (the app builds the address itself). They are shown only as you choose (to your followers, which is the default, to everyone who can see your profile, or to nobody but you), you can change or delete them at any time, and they go with your account. Opening one takes you to that platform, which has its own privacy policy; your browser sends it no referrer.',
              '**Your reading data.** The books in your Library and their status, your reading sessions (start and end dates, finished or given up, a rating, a review, the reason if you stopped), your progress, your Collections, page counts and editions you set yourself, your own list of book links, and the reading places and highlights (the words you select) you keep in the ebook reader. If you import a Goodreads or Hardcover export, the file is read in your browser and only the resulting books and reads are stored.',
              '**Friends (only if you use them).** Whom you follow and who follows you, follow requests, people you block, your privacy settings (private or public account, what followers may see), your follow link and a record of who opened it, and the activity (for example that you finished a book) your accepted followers see.',
              '**Your reading page (only if you turn it on).** A page of your reading at a link only you hand out. It shows the sections you pick, never your email address, notes, highlights or a review you did not share. Anyone with the link can open it without signing in.',
              '**The waitlist (if you are not a member).** If you leave your email address on a reading page to ask for an invite: the address, the date, whose page you came from (I see that member’s first name), the language the page was in (German or English, so that the invite is written in it) and which wording you saw beside the button. Nothing else.',
              '**An error and performance log.** When the app crashes, or when a screen measured as poor (very slow, jumpy), it sends a short technical line: the kind of error, the message and stack without email addresses, tokens or URL parameters, the screen’s address pattern (for example /book/:key, never a book’s id), the app version, a short description of your browser, whether the app was installed and online, and your account id (when you were signed out, a salted hash of your address instead of the address). Never book titles, notes, reviews or search words.',
              '**Page-load statistics.** Cloudflare Web Analytics counts page loads and performance figures (such as load time, country and browser type). It sets no cookies and stores nothing on your device, and I do not use it to follow individual people.',
              '**Connection data.** Like any website, the hosting and database providers receive your IP address and technical details of each request when your device connects, to deliver the app and keep it secure.',
              '**Only on your device.** Ebook files you link, the offline copy of your Library, changes waiting to sync, covers you looked at and your theme choice. They stay on your device, and signing out removes your Library from it (the theme stays). The camera is used for the barcode scanner only; its images are neither stored nor sent.',
            ],
          },
          { p: 'As the operator I can technically reach the database, including email addresses and reading data. I use that access only to run, secure and repair the app.' },
        ],
      },
      {
        id: 'bases',
        heading: 'Legal bases',
        blocks: [
          {
            ul: [
              'The account, sign-in, your Library, Friends, your reading page and the emails with sign-in codes: providing the app you signed up for, Art. 6(1)(b) GDPR.',
              'What you show to others (a public account, accepted followers, profile links, a reading page, a shared review) happens only because you switch it on or accept a request, and you can switch it off again at any time. Where you decide to publish something, the legal basis is also your consent, Art. 6(1)(a) GDPR, which you withdraw by switching it off.',
              'The waitlist: your consent, Art. 6(1)(a) GDPR. You give me the address so that I can invite you, and I delete it when you ask.',
              'The error and performance log, page-load statistics, hosting logs, encrypted backups and security measures: my legitimate interest in an app that runs, is secure and can be restored after a loss, Art. 6(1)(f) GDPR.',
            ],
          },
        ],
      },
      {
        id: 'recipients',
        heading: 'Who receives data',
        blocks: [
          { p: 'I use these services to run BetterReads. Each processes data on my behalf, under the data processing terms the provider offers. I sell no data, and the app has no advertising and no third-party tracking.' },
          {
            ul: [
              '**Supabase** (the database, sign-in, profile photo storage and server functions): the project runs in the EU region eu-central-1 (Frankfurt, Germany). It holds everything you save in the app and your email address. The provider is Supabase Pte. Ltd., Singapore.',
              '**Cloudflare Pages** (hosting of the app’s files and of link previews of reading pages; Web Analytics): Cloudflare, Inc., USA. Cloudflare answers from a data centre near you and sees your IP address while it does.',
              '**Cloudflare R2** (the nightly backup of the database): a private storage space with a location hint for Western Europe. The backup is encrypted before it is uploaded, with a key only I hold, and each file is deleted after 35 days.',
              '**Resend** (email): Resend (Plus Five Five, Inc., USA) sends the sign-in codes, invites and notification emails. It receives the recipient’s email address, the message content (the code or the invite link) and delivery metadata. The sending region is Ireland (EU). Because the provider is a US company, transfers rest on the EU Standard Contractual Clauses (Module Two, controller to processor) in its [data processing addendum](https://resend.com/legal/dpa), which also records its commitments under the EU-U.S. Data Privacy Framework. Its [sub-processors](https://resend.com/legal/subprocessors) are listed on its site.',
              '**GitHub** (the code, which is public, and its automated tests): none of your data. The backup job encrypts the database dump while it streams and leaves no copy of it in GitHub.',
              '**Other members** see only what you choose to show (see Friends and your reading page above).',
            ],
          },
        ],
      },
      {
        id: 'lookups',
        heading: 'Book lookups and other services your device or my server asks',
        blocks: [
          { p: 'To find books, covers and facts about them, BetterReads asks public book services. Each gets only what it needs to answer, and none gets your account.' },
          {
            ul: [
              '**Apple (iTunes Search) and Open Library**: your browser asks them directly for the words you type into search (from two characters on) or the ISBN you scan, and loads the covers. They therefore see your IP address and what you searched for. A book you imported keeps the cover address of its source, so that host sees your IP address when the cover is shown.',
              '**Wikimedia Commons**: author portraits on author pages are loaded by your browser, so Wikimedia sees your IP address.',
              '**Wikidata, Wikipedia, Open Library, Apple, the German National Library and Goodreads, asked by my server and never by your device**: facts about a book or author, short introductions, German editions (the library’s catalogue data is open, CC0) and the Goodreads community rating, looked up by title, author or ISBN. No member data goes with a lookup, and Goodreads never sees you.',
              '**The ebook reader**: Translate and Define send only the words you select to MyMemory (translated.net), unless your browser translates on the device by itself, and to the English Wiktionary. The ebook itself never leaves your device.',
              '**My own shelf**: a view only I have loads a file from my own domain, books.fabkho.dev. It holds no member data.',
            ],
          },
        ],
      },
      {
        id: 'storage',
        heading: 'Cookies and storage on your device',
        blocks: [
          { p: 'BetterReads sets no cookies. It uses your device’s storage (local storage, IndexedDB and the installed app’s cache) for what it needs to work: your sign-in session, the offline copy of your Library, changes waiting to sync, linked ebook files, covers, the app’s own files and your theme choice. This is strictly necessary for the app you asked for, so there is no cookie banner. Cloudflare Web Analytics needs no cookie and no storage.' },
        ],
      },
      {
        id: 'retention',
        heading: 'How long I keep data',
        blocks: [
          {
            ul: [
              '**Your account and everything in it**: until you delete the account (Profile, then Delete account). It is then removed from the database at once: your Library, reading sessions, ratings, reviews, Collections, name, photo, profile links, follows, follow requests, blocks, activity and sign-in.',
              '**Backups**: a nightly encrypted backup is deleted after 35 days, so a deleted account has left the backups within 35 days. Profile photos are not part of the backups.',
              '**Error and performance log**: 30 days; a member’s rows go with her account.',
              '**A sign-up that is never confirmed**: removed after a day.',
              '**The waitlist**: kept to send you an invite, and deleted when you ask.',
              '**Providers’ own logs** (hosting, email delivery, page-load statistics): as long as each provider’s own rules say.',
            ],
          },
        ],
      },
      {
        id: 'rights',
        heading: 'Your rights',
        blocks: [
          { p: 'You have the right to access, rectification, erasure, restriction of processing, data portability and objection (Art. 15 to 21 GDPR). Where processing rests on your consent, you can withdraw it at any time, with effect for the future. Much of this is in the app: you change your name, photo and sharing under Profile, and delete your account there, which cannot be undone.' },
          { p: `A download of your data is coming. Until then, write to ${EMAIL_LINK} and I send you your data in a common, machine-readable format. I answer within one month.` },
          { p: 'You may object at any time to processing based on my legitimate interest (Art. 21 GDPR). There are no automated decisions about you and no profiling.' },
          { p: 'You can complain to a data protection authority, for example the one responsible for me: the State Commissioner for Data Protection and Freedom of Information of North Rhine-Westphalia (LDI NRW), Postfach 20 04 44, 40102 Düsseldorf, [www.ldi.nrw.de](https://www.ldi.nrw.de). Complaints go through the complaint form on that site.' },
        ],
      },
      {
        id: 'security',
        heading: 'Security',
        blocks: [
          { p: 'Every connection uses HTTPS. The database itself limits who may read what (row-level security): you read your own Library, reviews and Collections, and other members only what the follow and sharing rules let them see. There are no passwords to leak. Backups are encrypted before they leave the build server. The code is public, so anyone can check it, and security reports are handled privately (see SECURITY.md in the repository). BetterReads is a free beta run by one person: it has no security certification, and I cannot promise that nothing will ever go wrong. If a breach affects you, I will tell you and the authority as the law requires.' },
        ],
      },
      {
        id: 'children',
        heading: 'Children',
        blocks: [
          { p: 'BetterReads is not for people under 16. Please do not create an account if you are younger. If I learn that someone under 16 has an account, I delete it.' },
        ],
      },
      {
        id: 'changes',
        heading: 'Changes to this notice',
        blocks: [
          { p: 'When the app or the services behind it change, I change this notice and its version date. I tell members in the app or by email about changes that matter to them.' },
        ],
      },
    ],
  },
  de: {
    title: 'Datenschutzerklärung',
    lead: 'BetterReads ist eine kleine App, mit der man seine gelesenen Bücher festhält, und läuft als Beta nur mit Einladung. Hier steht, was die App mit deinen Daten macht, wer sonst beteiligt ist und was du dagegen oder dafür tun kannst.',
    version: 'Stand: 28. Oktober 2026',
    sections: [
      {
        id: 'responsible',
        heading: 'Wer verantwortlich ist',
        blocks: [
          { p: 'Verantwortlich im Sinne der DSGVO ist:' },
          { lines: ['Fabian Kirchhoff', ...(IMPRINT_ENABLED ? [X.address] : []), `E-Mail: ${EMAIL_LINK}`] },
          { p: 'Ich betreibe BetterReads allein, als privates Projekt ohne Gewinnabsicht. Einen Datenschutzbeauftragten gibt es nicht; er ist nicht vorgeschrieben. Mitglieder können mir auch über „Kontakt“ in ihrem Profil schreiben.' + (IMPRINT_ENABLED ? ' Dieselben Angaben stehen im [Impressum](/imprint).' : '') },
        ],
      },
      {
        id: 'data',
        heading: 'Welche Daten ich verarbeite und wozu',
        blocks: [
          { p: 'Nur, was die App braucht. Was freiwillig ist, steht dabei.' },
          {
            ul: [
              '**Dein Konto.** Deine E-Mail-Adresse (um dir Anmeldecodes zu schicken und Konten zu unterscheiden), der Einladungscode, mit dem du dich angemeldet hast, die Sprache, die du in der App nutzt (Deutsch oder Englisch, damit dein Anmeldecode in ihr ankommt), und wann das Konto angelegt wurde. Es gibt kein Passwort: Du meldest dich mit einem sechsstelligen Code an, der per E-Mail kommt. Supabase Auth speichert außerdem technische Angaben zu deinen Anmeldungen, etwa die Zeit, deine IP-Adresse und deinen Browser, um Sitzungen zu schützen.',
              '**Dein Name und dein Foto (freiwillig).** Ein Name, den du selbst wählst, und ein Profilfoto. Das Foto wird auf deinem Gerät quadratisch zugeschnitten und verkleinert, bevor es in einen privaten Speicher hochgeladen wird, und nur Personen gezeigt, die dein Profil sehen dürfen.',
              '**Links zu deinen anderen Profilen (freiwillig).** Wenn du sie hinzufügst: ein Name oder eine Kennung für jeweils Goodreads, Reado, YouTube, Instagram und TikTok, nie ein frei wählbarer Link (die App baut die Adresse selbst). Sie werden nur gezeigt, wie du es einstellst (deinen Followern, das ist die Voreinstellung, allen, die dein Profil sehen dürfen, oder niemandem außer dir), du kannst sie jederzeit ändern oder löschen, und sie verschwinden mit deinem Konto. Ein Klick öffnet die jeweilige Plattform, die eine eigene Datenschutzerklärung hat; dein Browser sendet ihr keinen Referrer.',
              '**Deine Lesedaten.** Die Bücher in deiner Bibliothek und ihr Status, deine Lesevorgänge (Anfangs- und Enddatum, beendet oder abgebrochen, eine Bewertung, eine Rezension, bei Abbruch der Grund), dein Lesefortschritt, deine Sammlungen, von dir gesetzte Seitenzahlen und Ausgaben, deine eigene Liste mit Buchlinks sowie die Leseorte und Markierungen (die Wörter, die du auswählst), die du im Ebook-Reader behältst. Importierst du einen Export von Goodreads oder Hardcover, wird die Datei in deinem Browser gelesen und nur das Ergebnis, also Bücher und Lesevorgänge, gespeichert.',
              '**Freunde (nur wenn du sie nutzt).** Wem du folgst und wer dir folgt, Folgeanfragen, Personen, die du blockierst, deine Datenschutz-Einstellungen (privates oder öffentliches Konto, was Follower sehen dürfen), dein Folge-Link und ein Vermerk, wer ihn geöffnet hat, sowie die Aktivität (zum Beispiel, dass du ein Buch beendet hast), die deine akzeptierten Follower sehen.',
              '**Deine Leseseite (nur wenn du sie einschaltest).** Eine Seite über dein Lesen unter einem Link, den nur du weitergibst. Sie zeigt die Abschnitte, die du auswählst, nie deine E-Mail-Adresse, Notizen, Markierungen oder eine Rezension, die du nicht geteilt hast. Jede Person mit dem Link kann sie ohne Anmeldung öffnen.',
              '**Die Warteliste (wenn du kein Mitglied bist).** Hinterlässt du auf einer Leseseite deine E-Mail-Adresse, um eine Einladung zu bekommen: die Adresse, das Datum, von wessen Seite du kamst (ich sehe den Vornamen des Mitglieds), in welcher Sprache die Seite war (Deutsch oder Englisch, damit die Einladung in ihr geschrieben ist) und welchen Wortlaut du neben dem Knopf gesehen hast. Sonst nichts.',
              '**Ein Fehler- und Leistungsprotokoll.** Stürzt die App ab oder war ein Bildschirm nachweislich schlecht (sehr langsam, ruckelig), schickt sie eine kurze technische Zeile: die Art des Fehlers, Meldung und Stack ohne E-Mail-Adressen, Tokens oder URL-Parameter, das Adressmuster des Bildschirms (zum Beispiel /book/:key, nie die Kennung eines Buchs), die App-Version, eine kurze Beschreibung deines Browsers, ob die App installiert und online war, und deine Konto-Kennung (warst du abgemeldet, stattdessen ein gesalzener Hash deiner Adresse statt der Adresse). Nie Buchtitel, Notizen, Rezensionen oder Suchbegriffe.',
              '**Seitenaufruf-Statistik.** Cloudflare Web Analytics zählt Seitenaufrufe und Leistungswerte (etwa Ladezeit, Land und Browsertyp). Es setzt keine Cookies, speichert nichts auf deinem Gerät, und ich nutze es nicht, um einzelne Personen zu verfolgen.',
              '**Verbindungsdaten.** Wie jede Website erhalten die Hosting- und Datenbank-Anbieter deine IP-Adresse und technische Angaben zu jeder Anfrage, wenn sich dein Gerät verbindet, um die App auszuliefern und sicher zu halten.',
              '**Nur auf deinem Gerät.** Ebook-Dateien, die du verknüpfst, die Offline-Kopie deiner Bibliothek, Änderungen, die noch auf den Abgleich warten, Cover, die du angesehen hast, und deine Designwahl. Sie bleiben auf deinem Gerät, und beim Abmelden wird deine Bibliothek davon entfernt (die Designwahl bleibt). Die Kamera dient nur dem Barcode-Scanner; ihre Bilder werden weder gespeichert noch gesendet.',
            ],
          },
          { p: 'Als Betreiber kann ich technisch auf die Datenbank zugreifen, auch auf E-Mail-Adressen und Lesedaten. Diesen Zugriff nutze ich nur, um die App zu betreiben, zu sichern und zu reparieren.' },
        ],
      },
      {
        id: 'bases',
        heading: 'Rechtsgrundlagen',
        blocks: [
          {
            ul: [
              'Konto, Anmeldung, deine Bibliothek, Freunde, deine Leseseite und die E-Mails mit Anmeldecodes: die Bereitstellung der App, für die du dich angemeldet hast, Art. 6 Abs. 1 lit. b DSGVO.',
              'Was du anderen zeigst (ein öffentliches Konto, akzeptierte Follower, Profil-Links, eine Leseseite, eine geteilte Rezension), geschieht nur, weil du es einschaltest oder eine Anfrage annimmst, und du kannst es jederzeit wieder ausschalten. Wo du dich entscheidest, etwas zu veröffentlichen, ist Rechtsgrundlage außerdem deine Einwilligung, Art. 6 Abs. 1 lit. a DSGVO, die du widerrufst, indem du es ausschaltest.',
              'Die Warteliste: deine Einwilligung, Art. 6 Abs. 1 lit. a DSGVO. Du gibst mir die Adresse, damit ich dich einladen kann, und ich lösche sie, wenn du es möchtest.',
              'Das Fehler- und Leistungsprotokoll, die Seitenaufruf-Statistik, Hosting-Protokolle, verschlüsselte Sicherungen und Sicherheitsmaßnahmen: mein berechtigtes Interesse an einer App, die läuft, sicher ist und nach einem Verlust wiederhergestellt werden kann, Art. 6 Abs. 1 lit. f DSGVO.',
            ],
          },
        ],
      },
      {
        id: 'recipients',
        heading: 'Wer Daten erhält',
        blocks: [
          { p: 'Diese Dienste setze ich ein, um BetterReads zu betreiben. Jeder verarbeitet Daten in meinem Auftrag, auf Grundlage der Auftragsverarbeitungsbedingungen, die der Anbieter anbietet. Ich verkaufe keine Daten, und die App hat keine Werbung und kein Tracking durch Dritte.' },
          {
            ul: [
              '**Supabase** (Datenbank, Anmeldung, Speicher für Profilfotos und Serverfunktionen): Das Projekt läuft in der EU-Region eu-central-1 (Frankfurt, Deutschland). Dort liegt alles, was du in der App speicherst, und deine E-Mail-Adresse. Anbieter ist Supabase Pte. Ltd., Singapur.',
              '**Cloudflare Pages** (Hosting der Dateien der App und der Link-Vorschauen von Leseseiten; Web Analytics): Cloudflare, Inc., USA. Cloudflare antwortet aus einem Rechenzentrum in deiner Nähe und sieht dabei deine IP-Adresse.',
              '**Cloudflare R2** (die nächtliche Sicherung der Datenbank): ein privater Speicher mit Standort-Hinweis Westeuropa. Die Sicherung wird vor dem Hochladen verschlüsselt, mit einem Schlüssel, den nur ich habe, und jede Datei wird nach 35 Tagen gelöscht.',
              '**Resend** (E-Mail): Resend (Plus Five Five, Inc., USA) verschickt die Anmeldecodes, Einladungen und Benachrichtigungs-E-Mails. Es erhält die E-Mail-Adresse der Empfängerin oder des Empfängers, den Inhalt der Nachricht (den Code oder den Einladungslink) und Zustelldaten. Die Versandregion ist Irland (EU). Weil der Anbieter ein US-Unternehmen ist, beruhen Übermittlungen auf den EU-Standardvertragsklauseln (Modul zwei, Verantwortlicher an Auftragsverarbeiter) in seinem [Auftragsverarbeitungsvertrag](https://resend.com/legal/dpa), der auch seine Verpflichtungen unter dem EU-U.S. Data Privacy Framework festhält. Seine [Unterauftragsverarbeiter](https://resend.com/legal/subprocessors) sind auf seiner Website aufgeführt.',
              '**GitHub** (der Code, der öffentlich ist, und seine automatischen Tests): keine Daten von dir. Der Sicherungs-Job verschlüsselt den Datenbank-Dump, während er läuft, und hinterlässt bei GitHub keine Kopie.',
              '**Andere Mitglieder** sehen nur, was du zeigen willst (siehe Freunde und deine Leseseite oben).',
            ],
          },
        ],
      },
      {
        id: 'lookups',
        heading: 'Buchabfragen und andere Dienste, die dein Gerät oder mein Server fragt',
        blocks: [
          { p: 'Um Bücher, Cover und Angaben dazu zu finden, fragt BetterReads öffentliche Buchdienste. Jeder bekommt nur, was er für die Antwort braucht, und keiner bekommt dein Konto.' },
          {
            ul: [
              '**Apple (iTunes Search) und Open Library**: Dein Browser fragt sie direkt nach den Wörtern, die du in die Suche tippst (ab zwei Zeichen), oder nach der ISBN, die du scannst, und lädt die Cover. Sie sehen deshalb deine IP-Adresse und wonach du gesucht hast. Ein importiertes Buch behält die Cover-Adresse seiner Quelle; dieser Server sieht deine IP-Adresse, wenn das Cover angezeigt wird.',
              '**Wikimedia Commons**: Porträts von Autorinnen und Autoren auf deren Seiten lädt dein Browser, Wikimedia sieht dabei deine IP-Adresse.',
              '**Wikidata, Wikipedia, Open Library, Apple, die Deutsche Nationalbibliothek und Goodreads, gefragt von meinem Server und nie von deinem Gerät**: Angaben zu einem Buch oder einer Autorin, kurze Vorstellungen, deutsche Ausgaben (die Katalogdaten der Bibliothek sind offen, CC0) und die Goodreads-Bewertung der Community, nachgeschlagen mit Titel, Autor oder ISBN. Zu einer Abfrage gehören keine Mitgliedsdaten, und Goodreads sieht dich nie.',
              '**Der Ebook-Reader**: Übersetzen und Nachschlagen schicken nur die Wörter, die du auswählst, an MyMemory (translated.net), sofern dein Browser nicht von selbst auf dem Gerät übersetzt, und an das englische Wiktionary. Das Ebook selbst verlässt dein Gerät nie.',
              '**Mein eigenes Regal**: Eine Ansicht, die nur ich habe, lädt eine Datei von meiner eigenen Domain books.fabkho.dev. Sie enthält keine Mitgliedsdaten.',
            ],
          },
        ],
      },
      {
        id: 'storage',
        heading: 'Cookies und Speicher auf deinem Gerät',
        blocks: [
          { p: 'BetterReads setzt keine Cookies. Es nutzt den Speicher deines Geräts (Local Storage, IndexedDB und den Cache der installierten App) für das, was zum Funktionieren nötig ist: deine Anmeldung, die Offline-Kopie deiner Bibliothek, Änderungen, die auf den Abgleich warten, verknüpfte Ebook-Dateien, Cover, die Dateien der App selbst und deine Designwahl. Das ist für die App, die du angefragt hast, unbedingt erforderlich, deshalb gibt es kein Cookie-Banner. Cloudflare Web Analytics braucht weder Cookie noch Speicher.' },
        ],
      },
      {
        id: 'retention',
        heading: 'Wie lange ich Daten aufbewahre',
        blocks: [
          {
            ul: [
              '**Dein Konto und alles darin**: bis du das Konto löschst (Profil, dann Konto löschen). Es wird dann sofort aus der Datenbank entfernt: deine Bibliothek, Lesevorgänge, Bewertungen, Rezensionen, Sammlungen, dein Name, dein Foto, Profil-Links, Follows, Folgeanfragen, Blockierungen, Aktivität und die Anmeldung.',
              '**Sicherungen**: Eine nächtliche verschlüsselte Sicherung wird nach 35 Tagen gelöscht, ein gelöschtes Konto ist also nach spätestens 35 Tagen aus den Sicherungen verschwunden. Profilfotos sind nicht Teil der Sicherungen.',
              '**Fehler- und Leistungsprotokoll**: 30 Tage; die Zeilen eines Mitglieds verschwinden mit seinem Konto.',
              '**Eine Anmeldung, die nie bestätigt wird**: wird nach einem Tag entfernt.',
              '**Die Warteliste**: wird aufbewahrt, um dir eine Einladung zu schicken, und gelöscht, wenn du darum bittest.',
              '**Protokolle der Anbieter selbst** (Hosting, E-Mail-Zustellung, Seitenaufruf-Statistik): so lange, wie die Regeln des jeweiligen Anbieters es vorsehen.',
            ],
          },
        ],
      },
      {
        id: 'rights',
        heading: 'Deine Rechte',
        blocks: [
          { p: 'Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch (Art. 15 bis 21 DSGVO). Wo die Verarbeitung auf deiner Einwilligung beruht, kannst du sie jederzeit mit Wirkung für die Zukunft widerrufen. Vieles geht direkt in der App: Name, Foto und Freigaben änderst du im Profil, und dort löschst du auch dein Konto, was sich nicht rückgängig machen lässt.' },
          { p: `Ein Download deiner Daten kommt noch. Bis dahin schreib an ${EMAIL_LINK}, dann schicke ich dir deine Daten in einem gängigen, maschinenlesbaren Format. Ich antworte innerhalb eines Monats.` },
          { p: 'Der Verarbeitung auf Grundlage meines berechtigten Interesses kannst du jederzeit widersprechen (Art. 21 DSGVO). Es gibt keine automatisierten Entscheidungen über dich und kein Profiling.' },
          { p: 'Du kannst dich bei einer Datenschutz-Aufsichtsbehörde beschweren, zum Beispiel bei der für mich zuständigen: der Landesbeauftragten für Datenschutz und Informationsfreiheit Nordrhein-Westfalen (LDI NRW), Postfach 20 04 44, 40102 Düsseldorf, [www.ldi.nrw.de](https://www.ldi.nrw.de). Beschwerden gehen über das Beschwerdeformular auf dieser Website.' },
        ],
      },
      {
        id: 'security',
        heading: 'Sicherheit',
        blocks: [
          { p: 'Jede Verbindung läuft über HTTPS. Die Datenbank selbst begrenzt, wer was lesen darf (Row-Level-Security): Du liest deine eigene Bibliothek, Rezensionen und Sammlungen, andere Mitglieder nur das, was ihnen die Regeln für Folgen und Teilen zeigen. Es gibt keine Passwörter, die abhandenkommen könnten. Sicherungen werden verschlüsselt, bevor sie den Build-Server verlassen. Der Code ist öffentlich, also kann ihn jeder prüfen, und Sicherheitsmeldungen werden vertraulich behandelt (siehe SECURITY.md im Repository). BetterReads ist eine kostenlose Beta, betrieben von einer Person: Es gibt keine Sicherheitszertifizierung, und ich kann nicht versprechen, dass nie etwas schiefgeht. Betrifft dich eine Datenpanne, sage ich dir und der Aufsichtsbehörde Bescheid, wie es das Gesetz verlangt.' },
        ],
      },
      {
        id: 'children',
        heading: 'Kinder',
        blocks: [
          { p: 'BetterReads ist nicht für Personen unter 16 Jahren. Bitte leg kein Konto an, wenn du jünger bist. Erfahre ich, dass jemand unter 16 ein Konto hat, lösche ich es.' },
        ],
      },
      {
        id: 'changes',
        heading: 'Änderungen dieser Erklärung',
        blocks: [
          { p: 'Ändern sich die App oder die Dienste dahinter, ändere ich diese Erklärung und ihr Datum. Über Änderungen, die für Mitglieder wichtig sind, informiere ich in der App oder per E-Mail.' },
        ],
      },
    ],
  },
}
