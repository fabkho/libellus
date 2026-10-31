CREATE OR REPLACE FUNCTION private.finished_same_book(p_member uuid, p_book uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select p_member is not null and exists (
    select 1
      from public.library_entries e
      join public.reading_sessions s on s.entry_id = e.id and s.outcome = 'finished'
      join public.books b on b.id = e.book_id
      join public.books w on w.id = p_book
     where e.member_id = p_member
       and (b.id = w.id
            or (w.openlibrary_work_key is not null and b.openlibrary_work_key = w.openlibrary_work_key))
  )
$function$
;
