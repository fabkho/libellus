CREATE OR REPLACE FUNCTION private.has_work(p_member uuid, p_work_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p_member is not null and p_work_key is not null and exists (
    select 1 from public.library_entries e
     where e.member_id = p_member and e.book_id in (select private.work_books(p_work_key))
  )
$function$
;
