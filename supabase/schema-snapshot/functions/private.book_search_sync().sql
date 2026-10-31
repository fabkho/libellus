CREATE OR REPLACE FUNCTION private.book_search_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  insert into private.book_search (book_id, words, title)
  values (new.id,
          to_tsvector('simple'::regconfig, public.book_search_text(new.title, new.authors)),
          btrim(public.book_search_text(new.title, '{}')))
  on conflict (book_id) do update
    set words = excluded.words, title = excluded.title;
  return null;
end;
$function$
;
