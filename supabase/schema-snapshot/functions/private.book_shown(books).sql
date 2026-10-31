CREATE OR REPLACE FUNCTION private.book_shown(p_book books)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select not p_book.check_failed
      or exists (select 1 from public.library_entries e
                  where e.member_id = (select auth.uid()) and e.book_id = p_book.id)
$function$
;
