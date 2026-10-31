CREATE OR REPLACE FUNCTION private.cover_store_reconcile()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  insert into private.cover_store_queue (book_id, source_url)
  select b.id, b.cover_url
    from public.books b
   where b.cover_key is null
     and b.cover_url is not null
     and private.cover_allowed(b.cover_url)
     and exists (select 1 from public.library_entries e where e.book_id = b.id)
     and not exists (select 1 from private.cover_store_queue q where q.book_id = b.id)
  on conflict (book_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end
$function$
;
