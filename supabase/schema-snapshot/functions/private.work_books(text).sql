CREATE OR REPLACE FUNCTION private.work_books(p_work_key text)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select b.id
    from public.book_works bw
    join public.books b on b.id = bw.book_id
   where left(p_work_key, 2) = 'w:' and bw.work_id = substr(p_work_key, 3)::uuid
     and bw.matched_by in ('openlibrary', 'isbn') and b.owner_id is null
  union
  select b.id
    from public.books b
   where left(p_work_key, 2) = 'b:' and b.id = substr(p_work_key, 3)::uuid and b.owner_id is null
$function$
;
