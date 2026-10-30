-- Own covers, part 3: the read path hands out the stored copy too (docs/plans/owned-covers.md, §9 PR 3).
--
-- PR 1 (20261108010000_cover_store.sql) added `books.cover_key` / `books.cover_widths`; PR 2 stores them. Nothing
-- read them yet, so a client that had a Book could not draw its cover from our own copy: it had the source's
-- address and then `/cover`. This migration adds the two to every answer that hands a Book's cover out, so the
-- app builds `c/<cover_key>/<w>` from the Book row alone (PR 4 reads it; the client is unchanged here).
--
-- The rule: the key travels exactly where its URL travels, and nowhere else.
--   * `private.reading_page_book_json` — the Book JSON of the social answers (feed, member_profile, member_want,
--     my_recent_likes, both_read, public_reading_page and its cards) and of `public.member_reading_record`, all
--     gated as the cover itself is (`private.cover_shown`). A hidden cover hands out neither URL nor key.
--   * `member_reading_record` — the same Book JSON, same gate (its own copy of the object).
--   * `work_card` (author page, a series sheet, Home's Next in your series) — the card's cover is the one its
--     page shows (her Book's, else the Catalogue's Book of the edition), so the key is that same Book's. There is
--     no key for the work's or the edition's own cover, which is not a Book. This card is not a social surface:
--     its URL is not gated by `cover_shown` (a manual Book's cover is hers), so neither is its key — and a Book
--     whose cover is off the allow-list has none anyway (`private.cover_store_reconcile` asks `cover_allowed`).
--   * `series_works` and `author_page` — her own Books' cards ("Other" on an author page, her own placements in a
--     series): the key of the Book whose URL the card already carries.
--   * The Library needs nothing here: `books` is read through the table itself (`grant select on public.books`,
--     20261003100000), which covers the two new columns, and the `books_readable` policy gates the row. PR 4 adds
--     them to `library.ts`'s `LIST_BOOK_COLUMNS` and to the types.
--
-- A Book with no stored copy (not stored yet, failed, gone, another host) has `cover_key` null: the answers then
-- carry no key, exactly as today, and the app falls back to `/cover` and the source.
--
-- Idempotent: `create or replace` of the current bodies (20261025020000_catalogue_check.sql's
-- reading_page_book_json and member_reading_record, 20261029010000_work_card_opens_cover.sql's work_card,
-- 20261011011000_authors_works_series.sql's series_works and author_page), signatures and grants as they were.
--
-- Counts only in the PR and the report, as everywhere in this plan.

comment on column public.books.cover_widths is
  'The real widths of the stored copy, ascending (read from each image''s header by the cover-store function): '
  'the image is c/<cover_key>/<width> for each of them. Null = not stored (yet).';

-- ------------------------------------------------------- the Book JSON of the social answers

create or replace function private.reading_page_book_json(p_book public.books)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select case when private.book_shown(p_book) then
    jsonb_build_object(
      'id', p_book.id,
      'title', p_book.title,
      'authors', to_jsonb(p_book.authors),
      'published_year', p_book.published_year,
      'cover_url', case when private.cover_shown(p_book) then p_book.cover_url end,
      'cover_thumbhash', case when private.cover_shown(p_book) then p_book.cover_thumbhash end,
      'cover_dominant', case when private.cover_shown(p_book) then p_book.cover_dominant end,
      'cover_secondary', case when private.cover_shown(p_book) then p_book.cover_secondary end,
      -- Our own copy of that cover (20261108010000, docs/plans/owned-covers.md §4): the image is
      -- c/<cover_key>/<width> for each of cover_widths. Gated as the URL is: a hidden cover hides its key too.
      'cover_key', case when private.cover_shown(p_book) then p_book.cover_key end,
      'cover_widths', case when private.cover_shown(p_book) then p_book.cover_widths end
    )
  else
    jsonb_build_object(
      'id', p_book.id,
      'title', null,
      'authors', '[]'::jsonb,
      'published_year', null,
      'cover_url', null,
      'cover_thumbhash', null,
      'cover_dominant', null,
      'cover_secondary', null,
      'cover_key', null,
      'cover_widths', null,
      'description', null,
      'unverified', true
    )
  end
$$;

revoke all on function private.reading_page_book_json(public.books) from public, anon, authenticated;

-- member_reading_record, from its latest body (20261025020000_catalogue_check.sql), whole; only the two cover
-- columns are new, gated as cover_url is. Grants as they were.
create or replace function public.member_reading_record(p_member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_s      public.social_settings;
  v_reads  jsonb;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.visible(v_caller, p_member) then
    return null;
  end if;
  v_s := private.social_of(p_member);
  if not v_s.show_year then
    return null;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', s.id,
             'entry_id', s.entry_id,
             'started_on', s.started_on,
             'ended_on', s.ended_on,
             'outcome', s.outcome,
             'rating', case when v_s.show_ratings then s.rating end,
             'created_at', s.created_at,
             'entry', jsonb_build_object(
               'page_count_override', e.page_count_override,
               -- The Book by the columns bookFromRow reads, named: never owner_id, nor a column added later.
               -- A Book that is not shown (private.book_shown) is `unverified`: nothing a member sent.
               'book', case when private.book_shown(b) then jsonb_build_object(
                 'id', b.id,
                 'created_at', b.created_at,
                 'title', b.title,
                 'authors', b.authors,
                 'isbn13', b.isbn13,
                 'isbn10', b.isbn10,
                 'page_count', b.page_count,
                 'published_year', b.published_year,
                 'language', b.language,
                 'publisher', b.publisher,
                 -- Withheld until the server's check has read it at its source (private.description_shown).
                 'description', case when private.description_shown(b) then b.description end,
                 -- A cover only where private.cover_shown says (1. above); else the Placeholder.
                 'cover_url', case when private.cover_shown(b) then b.cover_url end,
                 'cover_thumbhash', case when private.cover_shown(b) then b.cover_thumbhash end,
                 'cover_dominant', case when private.cover_shown(b) then b.cover_dominant end,
                 'cover_secondary', case when private.cover_shown(b) then b.cover_secondary end,
                 -- Our stored copy of that cover, hidden exactly when the cover is.
                 'cover_key', case when private.cover_shown(b) then b.cover_key end,
                 'cover_widths', case when private.cover_shown(b) then b.cover_widths end,
                 'source', b.source,
                 'apple_id', b.apple_id,
                 'openlibrary_edition_key', b.openlibrary_edition_key,
                 'openlibrary_work_key', b.openlibrary_work_key,
                 'format', b.format,
                 'goodreads', null)
               else jsonb_build_object(
                 'id', b.id,
                 'created_at', b.created_at,
                 'title', null,
                 'authors', '[]'::jsonb,
                 'isbn13', null,
                 'isbn10', null,
                 'page_count', null,
                 'published_year', null,
                 'language', null,
                 'publisher', null,
                 'description', null,
                 'cover_url', null,
                 'cover_thumbhash', null,
                 'cover_dominant', null,
                 'cover_secondary', null,
                 'cover_key', null,
                 'cover_widths', null,
                 'source', b.source,
                 'apple_id', null,
                 'openlibrary_edition_key', null,
                 'openlibrary_work_key', null,
                 'format', null,
                 'goodreads', null,
                 'unverified', true)
               end
             )
           ) order by s.ended_on nulls last, s.created_at, s.id), '[]'::jsonb)
    into v_reads
    from public.library_entries e
    join public.reading_sessions s on s.entry_id = e.id
    join public.books b on b.id = e.book_id
   where e.member_id = p_member and not e.hidden
     and ((s.outcome = 'finished' and v_s.show_finished)
          or (s.outcome = 'abandoned' and v_s.show_abandoned));

  return jsonb_build_object(
    'reads', v_reads,
    'wantToRead', case when v_s.show_want then
      (select count(*) from public.library_entries e
        where e.member_id = p_member and not e.hidden and e.status = 'want_to_read') end,
    'reading', case when v_s.show_reading then
      (select count(*) from public.library_entries e
        where e.member_id = p_member and not e.hidden
          and exists (select 1 from public.reading_sessions s
                       where s.entry_id = e.id and s.outcome is null)) end
  );
end;
$$;

revoke all on function public.member_reading_record(uuid) from public, anon;
grant execute on function public.member_reading_record(uuid) to authenticated;

-- ------------------------------------------------------------ the cards

-- work_card, from its latest body (20261029010000_work_card_opens_cover.sql), whole: the card's cover is the one
-- its page shows, so its key is that same Book's. None where the cover is the work's or the edition's own (not a
-- Book), and none where that Book has no stored copy.
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

comment on function public.work_card(uuid, text, numeric) is
  'Issue #167: a work''s card (author page, series sheet, More from the author, Home''s "Next in your series") — '
  'the edition it opens and that edition''s cover, plus our stored copy of it (coverKey, coverWidths) where the '
  'cover is a Book''s.';

-- series_works, from its body (20261011011000_authors_works_series.sql), whole: her own placements' cards carry
-- the stored copy of the cover they already carry.
create or replace function public.series_works(p_series uuid, p_language text default 'en')
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
             'coverKey', b.cover_key, 'coverWidths', b.cover_widths,
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

-- author_page, from its body (20261011011000_authors_works_series.sql), whole: the same for the "Other" cards of
-- her own Books whose work is not among the author's works.
create or replace function public.author_page(p_author text, p_language text default 'en')
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
