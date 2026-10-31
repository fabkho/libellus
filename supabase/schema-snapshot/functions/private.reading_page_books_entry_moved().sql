CREATE OR REPLACE FUNCTION private.reading_page_books_entry_moved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.book_id is distinct from old.book_id then
    update public.reading_page_books set book_id = new.book_id
     where member_id = new.member_id and book_id = old.book_id
       and not exists (select 1 from public.reading_page_books where member_id = new.member_id and book_id = new.book_id);
    delete from public.reading_page_books where member_id = new.member_id and book_id = old.book_id;
  end if;
  return new;
end;
$function$
;
