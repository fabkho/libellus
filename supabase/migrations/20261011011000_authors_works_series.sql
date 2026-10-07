-- Authors, their works and series, linked to the Catalogue (issues #166, #167).
--
-- A Book is one edition and stays one (SPEC.md: no work level in the member's
-- Library). What the author page and the series line need sits beside it, as
-- a cache of what Wikidata and Open Library say, filled by the `enrich` edge
-- function (supabase/functions/enrich) with the service role:
--
--   authors        a person: Wikidata item and/or Open Library author id, name,
--                  life dates, a photo with its credit, a short Wikipedia intro
--                  per language with its source URL; when it was fetched
--   works          a work (all its editions): Wikidata item and/or Open Library
--                  work key, title (and per language), first year, kind
--                  (novel, collection, …), a cover, a representative edition per
--                  language (title, ISBN, cover), its canonical genres
--   work_authors   who wrote it
--   series         a series: Wikidata item and/or Open Library series, name, the
--                  series it is part of (Discworld → City Watch)
--   work_series    a work's place in a series: position, decimals allowed
--                  (0.5 a prequel, 2.5 a novella); a work can be in two
--                  (Feet of Clay: Discworld 19, City Watch 4)
--   book_works     a Catalogue Book's work
--   book_authors   a Catalogue Book's credited names (books.authors, by position)
--                  that are authors of it, linked to their `authors` row
--   book_series    a view: a Book's series through its work
--
-- Catalogue facts: readable by every member, written only by the service role.
-- A Book with no data (nothing found anywhere) simply has no rows here; the app
-- works without any of it.
--
-- The member's own correction, per Library entry (it follows the entry through
-- Change edition): `entry_series` puts her entry into a series at a position,
-- or says it is in none. A series she names that the Catalogue does not know
-- is created as hers (`series.created_by`, visible to her only).
--
-- What phase 2's screens call (docs/ENRICHMENT.md), all security invoker except
-- the writers:
--
--   author_page(p_author, p_language)   the hero, genres and works (series in
--                                       order / standalone / other) with her statuses
--   book_authors_of(p_book)             a Book's linked authors (for links to their pages)
--   book_series_info(p_book)            the Book's series, its position and the
--                                       series' works with her statuses
--   series_works(p_series)              one series in order, with her statuses
--   next_in_series(p_limit)             Home: the next unfinished work of each
--                                       series she has finished a work of
--   set_entry_series(p_entry, p_series, p_name, p_position)   her correction
--   reset_entry_series(p_entry)                               back to the computed series
--
-- Refusals, as `raise` messages with stable SQLSTATEs:
--   not_signed_in      42501  no member behind the call
--   entry_not_found    P0002  no such entry in this member's Library
--   series_not_found   P0002  no such series (or not one she may see)
--   series_invalid     22023  a name that is empty or too long, a position that
--                             is negative or too large, both or neither of
--                             series and name where one is needed

-- -------------------------------------------------------------------- authors

create table public.authors (
  id                uuid primary key default gen_random_uuid(),
  wikidata_id       text unique,
  openlibrary_key   text unique,
  name              text not null,
  -- Life dates with their precision as Wikidata gives it: 9 = year, 10 = month,
  -- 11 = day (a year-only birth is stored as 1 January of that year).
  birth_date        date,
  birth_precision   smallint,
  death_date        date,
  death_precision   smallint,
  -- A portrait: Wikimedia Commons (P18) or Open Library's author photo.
  photo_url         text,
  -- {source: 'commons'|'openlibrary', artist, licence, licence_url, file_url}:
  -- what the credit under the photo says (Commons licences require it).
  photo_credit      jsonb,
  -- Per language: {"en": {"text": "…", "title": "Terry Pratchett",
  -- "url": "https://en.wikipedia.org/wiki/Terry_Pratchett"}}. Wikipedia text is
  -- CC BY-SA: the page credits it "From Wikipedia" with the URL.
  summaries         jsonb not null default '{}',
  -- When the facts (and the works) were last fetched; null = a stub that
  -- only names the author so far. Refreshed after 30 days.
  fetched_at        timestamptz,
  works_fetched_at  timestamptz,
  created_at        timestamptz not null default now(),

  constraint authors_wikidata_format check (wikidata_id ~ '^Q[1-9][0-9]{0,11}$'),
  constraint authors_openlibrary_format check (openlibrary_key ~ '^OL[1-9][0-9]{0,11}A$'),
  constraint authors_name_present check (char_length(btrim(name)) between 1 and 300),
  constraint authors_birth_precision check (birth_precision between 9 and 11),
  constraint authors_death_precision check (death_precision between 9 and 11),
  constraint authors_photo_url_https check (photo_url ~ '^https://'),
  constraint authors_summaries_object check (jsonb_typeof(summaries) = 'object')
);

comment on table public.authors is
  'Issue #167: an author as Wikidata and Open Library describe them (life dates, photo with credit, '
  'Wikipedia intro per language), a cache the enrich edge function fills and refreshes after 30 days. '
  'An author known to neither has a row by name only. Readable by every member.';

-- An author nobody knows (no Wikidata item, no Open Library id) is one row per
-- name, so the same name links to one page.
create unique index authors_name_only on public.authors (lower(name))
  where wikidata_id is null and openlibrary_key is null;

-- ---------------------------------------------------------------------- works

create table public.works (
  id                uuid primary key default gen_random_uuid(),
  wikidata_id       text unique,
  openlibrary_key   text unique,
  title             text not null,
  -- The work's title per language, from Wikidata's labels: {"de": "Einfach göttlich"}.
  titles            jsonb not null default '{}',
  first_year        smallint,
  -- What kind of work, for the author page's groups: novel and novella are
  -- "Standalone novels" when in no series; the rest "Other".
  kind              text,
  cover_url         text,
  -- A representative edition per language, from Open Library:
  -- {"en": {"title", "isbn13", "openlibrary_edition_key", "cover_url"}}.
  editions          jsonb not null default '{}',
  -- Canonical genres of the work (Wikidata P136 mapped), for the author page's chips.
  genre_ids         text[] not null default '{}',
  fetched_at        timestamptz,
  created_at        timestamptz not null default now(),

  constraint works_wikidata_format check (wikidata_id ~ '^Q[1-9][0-9]{0,11}$'),
  constraint works_openlibrary_format check (openlibrary_key ~ '^OL[1-9][0-9]{0,11}W$'),
  constraint works_identified check (wikidata_id is not null or openlibrary_key is not null),
  constraint works_title_present check (char_length(btrim(title)) between 1 and 500),
  constraint works_year_plausible check (first_year between -3000 and 2100),
  constraint works_kind check (kind in ('novel', 'novella', 'collection', 'short-story', 'nonfiction',
                                        'poetry', 'graphic', 'other')),
  constraint works_cover_url_https check (cover_url ~ '^https://'),
  constraint works_titles_object check (jsonb_typeof(titles) = 'object'),
  constraint works_editions_object check (jsonb_typeof(editions) = 'object')
);

comment on table public.works is
  'Issue #167: a work (all its editions) as Wikidata and Open Library describe it, for the author '
  'page and series. Filled by the enrich edge function. Readable by every member.';

create table public.work_authors (
  work_id    uuid not null references public.works on delete cascade,
  author_id  uuid not null references public.authors on delete cascade,
  position   smallint not null default 1,
  primary key (work_id, author_id)
);

create index work_authors_author on public.work_authors (author_id);

-- --------------------------------------------------------------------- series

create table public.series (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  wikidata_id      text unique,
  openlibrary_key  text unique,
  -- The series this one is part of (Wikidata P179 on the series): Discworld for City Watch.
  parent_id        uuid references public.series on delete set null,
  source           text not null,
  -- A series a member named herself (set_entry_series): hers, visible to her only.
  created_by       uuid references auth.users on delete cascade,
  -- When its works were last fetched (the neighbours of a Book in it).
  fetched_at       timestamptz,
  created_at       timestamptz not null default now(),

  constraint series_name_present check (char_length(btrim(name)) between 1 and 300),
  constraint series_wikidata_format check (wikidata_id ~ '^Q[1-9][0-9]{0,11}$'),
  constraint series_openlibrary_format check (openlibrary_key ~ '^OL[1-9][0-9]{0,11}L$'),
  constraint series_source check (source in ('wikidata', 'openlibrary', 'member')),
  constraint series_member_iff_created_by check ((source = 'member') = (created_by is not null)),
  constraint series_not_own_parent check (parent_id <> id)
);

comment on table public.series is
  'Issue #167: a book series (Wikidata, Open Library, or named by a member, then hers only), and the '
  'series it is part of. Readable by every member, except the series a member named.';

create index series_parent on public.series (parent_id) where parent_id is not null;
create index series_created_by on public.series (created_by) where created_by is not null;
-- A series named only by its name (Open Library's free text): one row per name.
create unique index series_name_only on public.series (lower(name))
  where wikidata_id is null and openlibrary_key is null and created_by is null;
create unique index series_member_name on public.series (created_by, lower(name))
  where created_by is not null;

create table public.work_series (
  work_id    uuid not null references public.works on delete cascade,
  series_id  uuid not null references public.series on delete cascade,
  -- Its place in the series; null when the series gives none.
  position   numeric(6, 2),
  source     text not null,
  primary key (work_id, series_id),

  constraint work_series_position_range check (position >= 0 and position < 10000),
  constraint work_series_source check (source in ('wikidata', 'openlibrary'))
);

create index work_series_series on public.work_series (series_id, position);

-- ---------------------------------------------------------------- book links

create table public.book_works (
  book_id  uuid primary key references public.books on delete cascade,
  work_id  uuid not null references public.works on delete cascade,
  -- How the work was found: the Book's Open Library keys, its ISBN, or a title + author search.
  matched_by text not null,

  constraint book_works_matched_by check (matched_by in ('openlibrary', 'isbn', 'title'))
);

create index book_works_work on public.book_works (work_id);

create table public.book_authors (
  book_id    uuid not null references public.books on delete cascade,
  -- 1-based position in books.authors.
  position   smallint not null,
  author_id  uuid not null references public.authors on delete cascade,
  primary key (book_id, position),

  constraint book_authors_position_positive check (position > 0)
);

create index book_authors_author on public.book_authors (author_id);

comment on table public.book_works is 'Issue #167: a Catalogue Book''s work (enrich edge function).';
comment on table public.book_authors is
  'Issue #167: which of a Catalogue Book''s credited names (books.authors, 1-based position) is which '
  'author. Translators and introducers credited by the edition are not linked.';

-- A Book's series, through its work.
create view public.book_series
with (security_invoker = true)
as
  select bw.book_id, ws.series_id, ws.position, ws.source
    from public.book_works bw
    join public.work_series ws on ws.work_id = bw.work_id;

comment on view public.book_series is 'Issue #167: a Catalogue Book''s series and position, through its work.';

-- ------------------------------------------------------- the member's series

create table public.entry_series (
  entry_id    uuid primary key references public.library_entries (id) on delete cascade,
  member_id   uuid not null references auth.users on delete cascade,
  -- Null: she says the Book is in no series.
  series_id   uuid references public.series on delete cascade,
  position    numeric(6, 2),
  updated_at  timestamptz not null default now(),

  constraint entry_series_position_range check (position >= 0 and position < 10000),
  constraint entry_series_position_needs_series check (series_id is not null or position is null)
);

comment on table public.entry_series is
  'Issue #167: the member''s own series and position for one Library entry, or "in no series" '
  '(series_id null). Replaces the computed series for her. Written through set_entry_series.';

create index entry_series_member on public.entry_series (member_id);
create index entry_series_series on public.entry_series (series_id) where series_id is not null;

-- ------------------------------------------------------------------------ RLS

alter table public.authors enable row level security;
alter table public.works enable row level security;
alter table public.work_authors enable row level security;
alter table public.series enable row level security;
alter table public.work_series enable row level security;
alter table public.book_works enable row level security;
alter table public.book_authors enable row level security;
alter table public.entry_series enable row level security;

revoke all on public.authors, public.works, public.work_authors, public.series, public.work_series,
              public.book_works, public.book_authors, public.entry_series, public.book_series
  from anon, authenticated;
grant select on public.authors, public.works, public.work_authors, public.series, public.work_series,
                public.book_works, public.book_authors, public.entry_series, public.book_series
  to authenticated;
grant select, insert, update, delete on public.authors, public.works, public.work_authors, public.series,
                public.work_series, public.book_works, public.book_authors, public.entry_series
  to service_role;
grant select on public.book_series to service_role;

create policy authors_readable on public.authors for select to authenticated using (true);
create policy works_readable on public.works for select to authenticated using (true);
create policy work_authors_readable on public.work_authors for select to authenticated using (true);
create policy work_series_readable on public.work_series for select to authenticated using (true);
create policy series_readable on public.series
  for select to authenticated
  using (created_by is null or created_by = (select auth.uid()));
create policy book_works_readable on public.book_works
  for select to authenticated
  using (exists (select 1 from public.books b where b.id = book_id));
create policy book_authors_readable on public.book_authors
  for select to authenticated
  using (exists (select 1 from public.books b where b.id = book_id));
create policy entry_series_own on public.entry_series
  for select to authenticated
  using (member_id = (select auth.uid()));

-- ------------------------------------------------------------ her works

-- Her Library, by work: for every work one of her Books belongs to, her best
-- entry of it (finished before reading before want to read, then the latest),
-- with the Rating of its latest finished read. What the author page and the
-- series lists show as "her status".
create function public.my_works()
returns table (work_id uuid, entry_id uuid, book_id uuid, status public.entry_status,
               rating smallint, finished_on date)
language sql
stable
set search_path = pg_catalog, public
as $$
  select distinct on (bw.work_id)
         bw.work_id, e.id, e.book_id, e.status, last_read.rating, last_read.ended_on
    from public.library_entries e
    join public.book_works bw on bw.book_id = e.book_id
    left join lateral (
      select s.rating, s.ended_on
        from public.reading_sessions s
       where s.entry_id = e.id and s.outcome = 'finished'
       order by s.ended_on desc nulls last, s.created_at desc
       limit 1
    ) last_read on true
   where e.member_id = (select auth.uid())
   order by bw.work_id,
            case e.status when 'finished' then 0 when 'reading' then 1 else 2 end,
            e.added_at desc
$$;

comment on function public.my_works() is
  'Issue #167: the calling member''s best Library entry per work, with the Rating of its latest '
  'finished read. Used by author_page, book_series_info, series_works, next_in_series.';

-- One work as the screens show it, in the member's language where there is an
-- edition in it, with her entry of it (or none): her own edition's title and
-- cover where she has one. The shape every reader below lists works in.
create function public.work_card(p_work uuid, p_language text default 'en', p_position numeric default null)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'workId', w.id,
    'wikidataId', w.wikidata_id,
    'openLibraryKey', w.openlibrary_key,
    'title', coalesce(mine.title, w.editions -> p_language ->> 'title', w.titles ->> p_language, w.title),
    'year', w.first_year,
    'kind', w.kind,
    'position', p_position,
    'coverUrl', coalesce(mine.cover_url, w.editions -> p_language ->> 'cover_url', w.cover_url),
    'genres', to_jsonb(w.genre_ids),
    'edition', w.editions -> p_language,
    'entry', case when mine.entry_id is not null then jsonb_strip_nulls(jsonb_build_object(
      'entryId', mine.entry_id, 'bookId', mine.book_id, 'status', mine.status,
      'rating', mine.rating, 'finishedOn', mine.ended_on)) end
  ))
  from public.works w
  left join lateral (
    select e.id as entry_id, e.book_id, e.status, b.title, b.cover_url, last_read.rating, last_read.ended_on
      from public.book_works bw
      join public.library_entries e on e.book_id = bw.book_id and e.member_id = (select auth.uid())
      join public.books b on b.id = e.book_id
      left join lateral (
        select s.rating, s.ended_on from public.reading_sessions s
         where s.entry_id = e.id and s.outcome = 'finished'
         order by s.ended_on desc nulls last, s.created_at desc
         limit 1
      ) last_read on true
     where bw.work_id = w.id
     order by case e.status when 'finished' then 0 when 'reading' then 1 else 2 end, e.added_at desc
     limit 1
  ) mine on true
  where w.id = p_work
$$;

revoke all on function public.my_works() from public, anon;
revoke all on function public.work_card(uuid, text, numeric) from public, anon;
grant execute on function public.my_works() to authenticated, service_role;
grant execute on function public.work_card(uuid, text, numeric) to authenticated, service_role;

-- -------------------------------------------------------------- the readers

-- A series as a list: its works in order (works without a position last), each
-- with her status, plus her own entries she put into it (set_entry_series) as
-- `member` items. Null when there is no such series she may see.
create function public.series_works(p_series uuid, p_language text default 'en')
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  with s as (
    select * from public.series where id = p_series
  ),
  computed as (
    select ws.position, public.work_card(w.id, p_language, ws.position) as card, w.id as work_id
      from public.work_series ws
      join public.works w on w.id = ws.work_id
     where ws.series_id = p_series
  ),
  -- Her entries she placed here herself, unless their work is listed already.
  hers as (
    select es.position,
           jsonb_strip_nulls(jsonb_build_object(
             'title', b.title, 'coverUrl', b.cover_url, 'year', b.published_year, 'position', es.position,
             'source', 'member',
             'entry', jsonb_strip_nulls(jsonb_build_object('entryId', e.id, 'bookId', e.book_id, 'status', e.status))
           )) as card
      from public.entry_series es
      join public.library_entries e on e.id = es.entry_id
      join public.books b on b.id = e.book_id
     where es.series_id = p_series
       and es.member_id = (select auth.uid())
       and not exists (select 1 from public.book_works bw join computed c on c.work_id = bw.work_id
                        where bw.book_id = e.book_id)
  )
  select jsonb_build_object(
    'id', s.id, 'name', s.name, 'wikidataId', s.wikidata_id, 'parentId', s.parent_id,
    'parentName', (select p.name from public.series p where p.id = s.parent_id),
    'source', s.source,
    -- "Book 2 of 9": the whole-numbered positions.
    'count', (select count(distinct position) from (select position from computed union all select position from hers) a
               where position is not null and position = trunc(position)),
    'works', coalesce((select jsonb_agg(card order by position nulls last, card ->> 'year', card ->> 'title')
                         from (select position, card from computed union all select position, card from hers) a), '[]')
  )
  from s
$$;

comment on function public.series_works(uuid, text) is
  'Issue #167: one series in reading order with the calling member''s statuses (and her own '
  'entries she placed in it). Null when there is no such series she may see.';

-- A Book's series for the member: her correction for her entry of it if she
-- made one, else the computed ones (the most specific first: City Watch before
-- Discworld), each with the Book's position and the series' works.
--   {"overridden": false, "series": [{…series_works…, "position": 4}, …]}
create function public.book_series_info(p_book uuid, p_language text default 'en')
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  with mine as (
    select es.series_id, es.position
      from public.entry_series es
      join public.library_entries e on e.id = es.entry_id
     where e.book_id = p_book and e.member_id = (select auth.uid())
     limit 1
  ),
  memberships as (
    select series_id, position, 'member' as source from mine where series_id is not null
    union all
    select bs.series_id, bs.position, bs.source
      from public.book_series bs
     where bs.book_id = p_book and not exists (select 1 from mine)
  )
  select jsonb_build_object(
    'overridden', exists (select 1 from mine),
    'series', coalesce((
      select jsonb_agg(public.series_works(m.series_id, p_language)
                       || jsonb_strip_nulls(jsonb_build_object('position', m.position, 'membership', m.source))
                       order by (select count(*) from public.series c where c.parent_id = m.series_id),
                                s.parent_id is null, s.name)
        from memberships m
        join public.series s on s.id = m.series_id
       where s.created_by is null or s.created_by = (select auth.uid())
    ), '[]')
  )
$$;

comment on function public.book_series_info(uuid, text) is
  'Issue #167: a Book''s series for the calling member (her correction, else computed; most specific '
  'first), each with the Book''s position and the series'' works with her statuses.';

-- A Book's linked authors, in credit order: what the Book page links to /author/<key>.
create function public.book_authors_of(p_book uuid)
returns table (credit_position smallint, name text, author_id uuid, author_key text)
language sql
stable
set search_path = pg_catalog, public
as $$
  select ba.position, a.name, a.id, coalesce(a.wikidata_id, a.openlibrary_key, a.id::text)
    from public.book_authors ba
    join public.authors a on a.id = ba.author_id
   where ba.book_id = p_book
   order by ba.position
$$;

comment on function public.book_authors_of(uuid) is
  'Issue #167: a Book''s linked authors in credit order, with the key their page is opened by.';

-- The author by any of their keys: a Wikidata item (Q…), an Open Library
-- author id (OL…A) or the row's uuid.
create function public.author_by_key(p_author text)
returns public.authors
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_author public.authors;
begin
  if p_author ~ '^Q[1-9][0-9]{0,11}$' then
    select * into v_author from public.authors where wikidata_id = p_author;
  elsif p_author ~ '^OL[1-9][0-9]{0,11}A$' then
    select * into v_author from public.authors where openlibrary_key = p_author;
  elsif p_author ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_author from public.authors where id = p_author::uuid;
  end if;
  return v_author;
end;
$$;

-- The author page (issue #167): the hero, the genre chips and the works,
-- deduplicated per work and grouped:
--   series      each series with at least one of the author's works at a
--               position, in reading order, most specific series first; a
--               work in a sub-series is listed there and not again in its
--               parent (Discworld lists the books in no sub-series)
--   standalone  novels and novellas in no series
--   other       everything else: collections, non-fiction, works of a series
--               without a position, and her own Books of the author whose
--               work is not known
-- Each work carries her status (and Rating) or none. Null when there is no
-- such author. `stale` says the cache is older than 30 days or the works were
-- never fetched: the app may ask the enrich function to refresh it.
create function public.author_page(p_author text, p_language text default 'en')
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  with a as (
    select * from public.author_by_key(p_author) where id is not null
  ),
  aw as (
    select w.* from public.works w
      join public.work_authors wa on wa.work_id = w.id
     where wa.author_id = (select id from a)
  ),
  -- Each work's series with a position, the most specific one only.
  placed as (
    select distinct on (aw.id) aw.id as work_id, ws.series_id, ws.position
      from aw
      join public.work_series ws on ws.work_id = aw.id and ws.position is not null
      join public.series s on s.id = ws.series_id
     order by aw.id, (select count(*) from public.series c where c.parent_id = s.id), s.parent_id is null, s.name
  ),
  series_groups as (
    select s.id, s.name, s.parent_id, s.wikidata_id,
           jsonb_agg(public.work_card(aw.id, p_language, p.position) order by p.position, aw.first_year) as works,
           min(aw.first_year) as first_year
      from placed p
      join aw on aw.id = p.work_id
      join public.series s on s.id = p.series_id
     group by s.id
  ),
  unplaced as (
    select aw.* from aw where not exists (select 1 from placed p where p.work_id = aw.id)
  ),
  -- Her Books credited to the author whose work is not among the works.
  her_books as (
    select jsonb_strip_nulls(jsonb_build_object(
             'title', b.title, 'year', b.published_year, 'coverUrl', b.cover_url,
             'entry', jsonb_strip_nulls(jsonb_build_object('entryId', e.id, 'bookId', b.id, 'status', e.status))
           )) as card, b.published_year
      from public.book_authors ba
      join public.books b on b.id = ba.book_id
      join public.library_entries e on e.book_id = b.id and e.member_id = (select auth.uid())
     where ba.author_id = (select id from a)
       and not exists (select 1 from public.book_works bw join aw on aw.id = bw.work_id where bw.book_id = b.id)
  ),
  genre_counts as (
    select g.genre, count(*) as n
      from (select unnest(aw.genre_ids) as genre from aw
            union all
            select bg.genre_id from public.book_genres bg
              join public.book_authors ba on ba.book_id = bg.book_id and ba.author_id = (select id from a)
             where bg.rank = 1) g
     group by g.genre
  )
  select jsonb_build_object(
    'author', jsonb_strip_nulls(jsonb_build_object(
      'id', a.id,
      'key', coalesce(a.wikidata_id, a.openlibrary_key, a.id::text),
      'name', a.name,
      'wikidataId', a.wikidata_id,
      'openLibraryKey', a.openlibrary_key,
      'born', case when a.birth_date is not null then jsonb_build_object('date', a.birth_date, 'precision', a.birth_precision) end,
      'died', case when a.death_date is not null then jsonb_build_object('date', a.death_date, 'precision', a.death_precision) end,
      'photo', case when a.photo_url is not null then jsonb_build_object('url', a.photo_url, 'credit', a.photo_credit) end,
      'summary', coalesce(
        case when a.summaries ? p_language then a.summaries -> p_language || jsonb_build_object('language', p_language) end,
        case when a.summaries ? 'en' then a.summaries -> 'en' || jsonb_build_object('language', 'en') end),
      'fetchedAt', a.fetched_at
    )),
    'genres', coalesce((select jsonb_agg(gc.genre order by gc.n desc, g.position)
                          from (select * from genre_counts order by n desc limit 4) gc
                          join public.genres g on g.id = gc.genre), '[]'),
    'series', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                 'id', sg.id, 'name', sg.name, 'wikidataId', sg.wikidata_id, 'parentId', sg.parent_id,
                                 'parentName', (select p.name from public.series p where p.id = sg.parent_id),
                                 'works', sg.works))
                               order by sg.parent_id is null, sg.first_year nulls last, sg.name)
                          from series_groups sg), '[]'),
    'standalone', coalesce((select jsonb_agg(public.work_card(u.id, p_language) order by u.first_year nulls last, u.title)
                              from unplaced u where u.kind in ('novel', 'novella')), '[]'),
    'other', coalesce((select jsonb_agg(card order by year nulls last, card ->> 'title')
                         from (select public.work_card(u.id, p_language) as card, u.first_year as year
                                 from unplaced u where u.kind is null or u.kind not in ('novel', 'novella')
                               union all
                               select card, published_year from her_books) o), '[]'),
    'stale', a.fetched_at is null or a.works_fetched_at is null or a.fetched_at < now() - interval '30 days'
  )
  from a
$$;

comment on function public.author_page(text, text) is
  'Issue #167: the author page by Wikidata item, Open Library author id or uuid — hero, genre chips, '
  'works grouped (series in order / standalone / other) with the calling member''s statuses.';

-- Home's "Next in your series": for each series in which she finished a work,
-- the first work after the last one she finished that she has not finished.
-- Her own corrections count (her entry placed in a series at a position). When
-- a work's sub-series and its parent both qualify, only the sub-series is
-- named (City Watch, not Discworld). Most recent finish first.
create function public.next_in_series(p_limit integer default 5, p_language text default 'en')
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  with mine as (select * from public.my_works()),
  -- Every (series, position) she has an entry at, with its status.
  her_places as (
    select ws.series_id, ws.position, m.status, m.finished_on, m.work_id,
           (select w.title from public.works w where w.id = m.work_id) as title
      from mine m
      join public.work_series ws on ws.work_id = m.work_id
     where ws.position is not null
       and not exists (select 1 from public.entry_series es where es.entry_id = m.entry_id)
    union all
    select es.series_id, es.position, e.status,
           (select max(s.ended_on) from public.reading_sessions s where s.entry_id = e.id and s.outcome = 'finished'),
           (select bw.work_id from public.book_works bw where bw.book_id = e.book_id),
           b.title
      from public.entry_series es
      join public.library_entries e on e.id = es.entry_id
      join public.books b on b.id = e.book_id
     where es.member_id = (select auth.uid()) and es.series_id is not null and es.position is not null
  ),
  last_finished as (
    select distinct on (series_id) series_id, position, finished_on, work_id, title
      from her_places
     where status = 'finished'
     order by series_id, position desc
  ),
  candidates as (
    select lf.series_id, lf.position as finished_position, lf.finished_on, lf.work_id as finished_work,
           lf.title as finished_title, nxt.work_id, nxt.position
      from last_finished lf
      join lateral (
        select ws.work_id, ws.position
          from public.work_series ws
         where ws.series_id = lf.series_id
           and ws.position > lf.position
           and not exists (select 1 from her_places hp
                            where hp.series_id = lf.series_id and hp.position = ws.position and hp.status = 'finished')
         order by ws.position
         limit 1
      ) nxt on true
  ),
  -- A parent series is left out when one of its sub-series is a candidate too.
  specific as (
    select c.* from candidates c
     where not exists (select 1 from candidates o join public.series s on s.id = o.series_id
                        where s.parent_id = c.series_id)
  )
  select coalesce(jsonb_agg(item order by finished_on desc nulls last), '[]')
    from (
      select jsonb_build_object(
               'series', jsonb_strip_nulls(jsonb_build_object('id', s.id, 'name', s.name, 'parentId', s.parent_id)),
               'finished', jsonb_strip_nulls(jsonb_build_object(
                  'position', sp.finished_position, 'workId', sp.finished_work, 'title', sp.finished_title)),
               'next', public.work_card(w.id, p_language, sp.position)
             ) as item,
             sp.finished_on
        from specific sp
        join public.series s on s.id = sp.series_id
        join public.works w on w.id = sp.work_id
       order by sp.finished_on desc nulls last
       limit greatest(1, least(coalesce(p_limit, 5), 50))
    ) items
$$;

comment on function public.next_in_series(integer, text) is
  'Issue #167: Home''s "Next in your series" — per series she finished a work of, the next work she '
  'has not finished, most recent finish first.';

revoke all on function public.series_works(uuid, text) from public, anon;
revoke all on function public.book_series_info(uuid, text) from public, anon;
revoke all on function public.book_authors_of(uuid) from public, anon;
revoke all on function public.author_by_key(text) from public, anon;
revoke all on function public.author_page(text, text) from public, anon;
revoke all on function public.next_in_series(integer, text) from public, anon;
grant execute on function public.series_works(uuid, text) to authenticated, service_role;
grant execute on function public.book_series_info(uuid, text) to authenticated, service_role;
grant execute on function public.book_authors_of(uuid) to authenticated, service_role;
grant execute on function public.author_by_key(text) to authenticated, service_role;
grant execute on function public.author_page(text, text) to authenticated, service_role;
grant execute on function public.next_in_series(integer, text) to authenticated, service_role;

-- -------------------------------------------------------------- the writers

-- Her series for one entry. Either an existing series (`p_series`, one she may
-- see) or a name (`p_name`): a name finds the Catalogue's series of that name
-- (Wikidata's first) or hers, else creates it as hers. Neither = "in no
-- series" (p_position must be null then). Returns book_series_info() for the
-- entry's Book.
create function public.set_entry_series(p_entry uuid, p_series uuid, p_name text, p_position numeric)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_book uuid;
  v_series uuid;
  v_name text := nullif(btrim(p_name), '');
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select book_id into v_book from public.library_entries where id = p_entry and member_id = v_member;
  if v_book is null then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if (p_series is not null and v_name is not null)
     or (p_series is null and v_name is null and p_position is not null)
     or p_position < 0 or p_position >= 10000
     or char_length(v_name) > 300 then
    raise exception 'series_invalid' using errcode = '22023';
  end if;

  if p_series is not null then
    select id into v_series from public.series
     where id = p_series and (created_by is null or created_by = v_member);
    if v_series is null then
      raise exception 'series_not_found' using errcode = 'P0002';
    end if;
  elsif v_name is not null then
    select id into v_series from public.series
     where lower(name) = lower(v_name) and (created_by is null or created_by = v_member)
     order by created_by is not null, wikidata_id is null, openlibrary_key is null, created_at
     limit 1;
    if v_series is null then
      insert into public.series (name, source, created_by)
      values (v_name, 'member', v_member)
      on conflict do nothing
      returning id into v_series;
      if v_series is null then
        select id into v_series from public.series where created_by = v_member and lower(name) = lower(v_name);
      end if;
    end if;
  end if;

  insert into public.entry_series (entry_id, member_id, series_id, position, updated_at)
  values (p_entry, v_member, v_series, round(p_position, 2), now())
  on conflict (entry_id) do update
     set series_id = excluded.series_id, position = excluded.position, updated_at = excluded.updated_at;

  return public.book_series_info(v_book);
end;
$$;

-- Back to the computed series for this entry. Returns book_series_info().
create function public.reset_entry_series(p_entry uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_book uuid;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select book_id into v_book from public.library_entries where id = p_entry and member_id = v_member;
  if v_book is null then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  delete from public.entry_series where entry_id = p_entry;
  return public.book_series_info(v_book);
end;
$$;

revoke all on function public.set_entry_series(uuid, uuid, text, numeric) from public, anon;
revoke all on function public.reset_entry_series(uuid) from public, anon;
grant execute on function public.set_entry_series(uuid, uuid, text, numeric) to authenticated;
grant execute on function public.reset_entry_series(uuid) to authenticated;
