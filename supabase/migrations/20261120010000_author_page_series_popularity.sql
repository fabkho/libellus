-- The author page drops its thin series and its cards carry the work's
-- popularity.
--
-- A series group with fewer than two covered works is noise on the author
-- page; its works fall back to `standalone`/`other` instead. A work is
-- *covered* when the calling member has a library entry of one of its books
-- (the cover expression `work_card` shows) or when the work itself carries a
-- cover for the page's language.
--
-- `work_card` gains the three popularity counts from the work's Open Library
-- search document (20261118020000_work_popularity.sql) so the app can order
-- by them without a round trip; nulls strip out of the card exactly like a
-- null `year` does.
--
-- `author_page` gains an `p_order` argument: `'most-read'` orders `standalone`
-- by `wantToReadCount` (nulls last) before year and title; any other value,
-- including `'default'`, is today's behaviour.
--
-- The two-argument `author_page(text, text)` is dropped: it is granted and
-- commented (20261011011000_authors_works_series.sql), so `create or replace`
-- with three arguments would create a second function; the same revoke/grant
-- are re-applied below, in the same form.
drop function public.author_page(text, text);

create or replace function public.work_card(p_work uuid, p_language text default 'en', p_position numeric default null)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'workId', w.id,
    'wikidataId', w.wikidata_id,
    'openLibraryKey', w.openlibrary_key,
    'title', coalesce(mine.title,
                      w.titles ->> p_language, w.editions -> p_language ->> 'title',
                      w.titles ->> 'en', w.editions -> 'en' ->> 'title',
                      w.title),
    'year', w.first_year,
    'kind', w.kind,
    'ratingsCount', w.ratings_count,
    'readinglogCount', w.readinglog_count,
    'wantToReadCount', w.want_to_read_count,
    'position', p_position,
    -- The cover of what the card opens, as its page shows it: her Book's, else the Catalogue's Book of the
    -- edition (none when that Book has none: the page shows the Placeholder then), else the edition's own,
    -- else the work's (lent: the page shows the row's), else the English edition's.
    'coverUrl', case
                  when mine.entry_id is not null then mine.cover_url
                  when catalogued.id is not null then catalogued.cover_url
                  else coalesce(opens.edition ->> 'cover_url', w.cover_url, w.editions -> 'en' ->> 'cover_url')
                end,
    -- Our stored copy of that same cover (20261108010000): the Book's key where the URL is a Book's, none where
    -- it is the work's or the edition's own. Not gated by cover_shown, as the URL here is not: this card is her
    -- own page, and a Book whose cover is off the allow-list has no stored copy anyway.
    'coverKey', case
                  when mine.entry_id is not null then mine.cover_key
                  when catalogued.id is not null then catalogued.cover_key
                end,
    'coverWidths', case
                     when mine.entry_id is not null then mine.cover_widths
                     when catalogued.id is not null then catalogued.cover_widths
                   end,
    'genres', to_jsonb(w.genre_ids),
    'edition', opens.edition,
    'entry', case when mine.entry_id is not null then jsonb_strip_nulls(jsonb_build_object(
      'entryId', mine.entry_id, 'bookId', mine.book_id, 'status', mine.status,
      'rating', mine.rating, 'finishedOn', mine.ended_on)) end
  ))
  from public.works w
  cross join lateral (select coalesce(w.editions -> p_language, w.editions -> 'en') as edition) opens
  left join lateral (
    select e.id as entry_id, e.book_id, e.status, b.title, b.cover_url, b.cover_key, b.cover_widths,
           last_read.rating, last_read.ended_on
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
  -- The Catalogue's Book of the edition the card opens, as the Book's page finds it (its key, utils/enrich.ts
  -- workBookKey: the ISBN-13, else the Open Library edition key; the unique Catalogue indexes books_catalogue_*).
  -- Not asked for a work she has: the card opens her Book.
  left join lateral (
    select b.id, b.cover_url, b.cover_key, b.cover_widths
      from public.books b
     where mine.entry_id is null
       and b.owner_id is null
       and b.isbn13 = opens.edition ->> 'isbn13'
       and opens.edition ->> 'isbn13' ~ '^97[89][0-9]{10}$'
    union all
    select b.id, b.cover_url, b.cover_key, b.cover_widths
      from public.books b
     where mine.entry_id is null
       and b.owner_id is null
       and b.openlibrary_edition_key = opens.edition ->> 'openlibrary_edition_key'
       and not coalesce(opens.edition ->> 'isbn13' ~ '^97[89][0-9]{10}$', false)
     limit 1
  ) catalogued on true
  where w.id = p_work
$$;

create or replace function public.author_page(p_author text, p_language text default 'en', p_order text default 'default')
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
           min(aw.first_year) as first_year,
           count(case when coalesce(aw_mine.cover_url, aw.editions -> p_language ->> 'cover_url', aw.cover_url) is not null then 1 end) as covered
      from placed p
      join aw on aw.id = p.work_id
      join public.series s on s.id = p.series_id
      left join lateral (
        select e.id as entry_id, e.book_id, e.status, b.title, b.cover_url, last_read.rating, last_read.ended_on
          from public.book_works bw
          join public.library_entries e on e.book_id = bw.book_id and e.member_id = (select auth.uid())
          join public.books b on b.id = e.book_id
          left join lateral (
            select s2.rating, s2.ended_on from public.reading_sessions s2
             where s2.entry_id = e.id and s2.outcome = 'finished'
             order by s2.ended_on desc nulls last, s2.created_at desc
             limit 1
          ) last_read on true
         where bw.work_id = aw.id
         order by case e.status when 'finished' then 0 when 'reading' then 1 else 2 end, e.added_at desc
         limit 1
      ) aw_mine on true
     group by s.id
  ),
  unplaced as (
    select aw.* from aw
      where not exists (select 1 from series_groups sg where sg.id = (select p.series_id from placed p where p.work_id = aw.id) and sg.covered >= 2)
  ),
  -- Her Books credited to the author whose work is not among the works.
  her_books as (
    select jsonb_strip_nulls(jsonb_build_object(
             'title', b.title, 'year', b.published_year, 'coverUrl', b.cover_url,
             'coverKey', b.cover_key, 'coverWidths', b.cover_widths,
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
                          from series_groups sg
                         where sg.covered >= 2), '[]'),
    'standalone', coalesce((select jsonb_agg(public.work_card(u.id, p_language)
                              order by case when p_order = 'most-read' then 0 else 1 end,
                                       case when p_order = 'most-read' then coalesce(u.want_to_read_count, 0) end desc,
                                       u.first_year nulls last, u.title)
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

comment on function public.author_page(text, text, text) is
  'Issue #167: the author page by Wikidata item, Open Library author id or uuid — hero, genre chips, '
  'works grouped (series in order / standalone / other, series with fewer than two covered works folded '
  'into standalone and other) with the calling member''s statuses; `p_order` of `most-read` orders the '
  'standalone works by their Open Library want-to-read count, any other value by year and title.';

revoke all on function public.author_page(text, text, text) from public, anon;
grant execute on function public.author_page(text, text, text) to authenticated, service_role;
