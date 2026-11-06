CREATE OR REPLACE FUNCTION private.book_work_key(p_book uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
           when b.owner_id is not null then null
           when bw.matched_by in ('openlibrary', 'isbn') then 'w:' || bw.work_id::text
           else 'b:' || b.id::text
         end
    from public.books b
    left join public.book_works bw on bw.book_id = b.id
   where b.id = p_book
$function$
;
