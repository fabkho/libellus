# Libellus — Domain glossary

The words Libellus uses for its domain, in code, copy, tests and issues alike. Terms only; how they
are stored and enforced is in [SPEC.md](SPEC.md) and issue #1.

- **Member** — a signed-in user.
- **Invite code** — what lets a new Member sign up. Has a use limit and may expire.
- **Book** — one *edition* of a title: its own ISBN, cover and page count. There is no work level
  above it.
- **Catalogue** — the shared set of Books that Members have added from Apple Books or OpenLibrary.
  Readable by every Member.
- **Manual book** — a Book a Member typed in by hand. Private to her Library, never in the Catalogue: no
  other Member finds it. Her Followers see it with her reads, but cannot open it, unless she hides it
  (*Hidden from followers*).
- **Own edition** — a Member's own edition of a Book no source knows (Change edition → "My edition isn't
  listed"): a Manual book with the Book's title and authors and her copy's details.
- **Format** — what an edition is: hardcover, paperback, ebook or audiobook. The source's, or the Member's
  own word on her entry's edition.
- **Library** — a Member's books.
- **Library entry** — one Book in one Member's Library.
- **Status** — the exclusive state of a Library entry: *Want to read*, *Currently reading* or
  *Finished*. Follows from the entry's Reading sessions.
- **Reading session** — one read of a Library entry: start date, end date, outcome (*finished* or
  *abandoned*), Rating, review, abandon reason. An **open** session has no outcome yet.
- **Abandoned** (DNF) — a session that ended without finishing. Shown under a *Not finished* filter,
  not a Status of its own.
- **Read again** — starting a new Reading session on a *Finished* entry; earlier sessions are kept.
- **Read as** — how a Member read a Library entry: *physical*, *ebook* or *audiobook* (or not said).
  Hers, not the edition's; where she has not said, the edition's format is the default.
- **Rating** — quarter stars from 0.25 to 5, per finished session. Optional.
- **Review** — optional text on a closed session.
- **Collection** — a Member's custom shelf. Non-exclusive: an entry can be in any number of
  Collections.
- **Cover** — a Book's front image, resolved once when the Book enters the Catalogue.
- **Placeholder cover** — a generated Cover (title and author on a colour surface) when no image
  exists.
- **Want to read row** — the short row of *Want to read* entries on Home (it was called "Up next").
- **Read in <year>** — the count of finished sessions with an end date in the current year,
  re-reads included.
- **Profile** — the member's page behind the avatar: her reading in figures (by year or all years), her
  Friends (Your circle, People, Your follow link, Privacy) and her account.
- **Year in review** — one calendar year of the Profile on a page of its own: its finished reads by
  month, its favourite, its records.
- **Follower** — a Member who follows another Member, once accepted (a Follow request) or at once (a Public
  account). A follower sees what the Member lets followers see: her switches, her figures, her Books that
  are not hidden. The same link seen from the other side is *following*.
- **Follow request** — a Member's ask to follow a Private account, waiting for the owner's answer. Accept
  makes the asker a follower; Decline tells nobody, and the asker still sees "Requested".
- **Private account** — the default for every Member. Nobody follows her except by her Accept, and nobody
  sees anything of hers before that. Turned off, it is a Public account.
- **Public account** — a Member's account that anyone with her Follow link can follow at once, without a
  Follow request. Her switches still apply.
- **Follow link** — a Member's link (`/f/<token>`, 128 random bits) that opens her profile for a signed-in
  visitor, who may then follow her or ask to. A new link kills the old one at once; followers stay.
- **Circle** — the Members a Member follows, and what they read: *Your circle* on Home and the feed. Not
  her followers.
- **Hidden from followers** — a Book a Member hides from her followers (the Book's ⋯): gone from their
  feed, her profile, her counts and her figures. It stays in her own Library and figures.
