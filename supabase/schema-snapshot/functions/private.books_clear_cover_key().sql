CREATE OR REPLACE FUNCTION private.books_clear_cover_key()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  new.cover_key := null;
  new.cover_widths := null;
  delete from private.cover_store_queue where book_id = new.id;
  return new;
end
$function$
;
