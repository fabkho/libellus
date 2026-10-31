CREATE OR REPLACE FUNCTION private.reading_page_books_entry_gone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  delete from public.reading_page_books where member_id = old.member_id and book_id = old.book_id;
  return old;
end;
$function$
;
