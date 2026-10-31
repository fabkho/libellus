CREATE OR REPLACE FUNCTION public.enrich_request(p_book uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if not exists (select 1 from public.books where id = p_book and owner_id is null) then
    return false;
  end if;
  insert into private.enrich_queue (book_id, reason) values (p_book, 'member')
  on conflict (book_id) do update set reason = 'member', not_before = least(private.enrich_queue.not_before, now());
  return true;
end;
$function$
;
