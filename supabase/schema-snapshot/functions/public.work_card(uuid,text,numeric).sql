CREATE OR REPLACE FUNCTION public.work_card(p_work uuid, p_language text DEFAULT 'en'::text, p_position numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$
;
