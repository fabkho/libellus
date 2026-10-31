CREATE OR REPLACE FUNCTION public.member_reading_record(p_member uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
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
$function$
;
