-- Issue #167: a work's title, cover and the edition "+ Want to read" adds, in
-- the member's language, else in English, else the work's own title (the
-- `enrich` function picks that one English first, then Wikidata's default
-- label `mul`, then any other). Before, a work with only a German title and
-- no English edition (Wikidata had moved Unseen Academicals' English name to
-- `mul`) showed "Der Club der unsichtbaren Gelehrten" to an English reader,
-- with no cover and nothing to add. The same card serves the author page, the
-- series sheet and Home's "Next in your series".

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
    'coverUrl', coalesce(mine.cover_url, w.editions -> p_language ->> 'cover_url', w.cover_url, w.editions -> 'en' ->> 'cover_url'),
    'genres', to_jsonb(w.genre_ids),
    'edition', coalesce(w.editions -> p_language, w.editions -> 'en'),
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

-- Authors with a work named in no English (the `mul` case above) are fetched
-- again the next time their page opens (author_page says `stale`, the app asks
-- the function), so their works get the English title and edition.
update public.authors a
   set works_fetched_at = null
 where a.works_fetched_at is not null
   and exists (select 1 from public.work_authors wa
                 join public.works w on w.id = wa.work_id
                where wa.author_id = a.id
                  and w.wikidata_id is not null
                  and not (w.titles ? 'en')
                  and not (w.editions ? 'en'));
