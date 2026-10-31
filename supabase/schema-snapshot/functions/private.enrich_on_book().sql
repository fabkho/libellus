CREATE OR REPLACE FUNCTION private.enrich_on_book()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  begin
    insert into private.enrich_queue (book_id, reason) values (new.id, 'new')
    on conflict (book_id) do nothing;
    perform private.enrich_kick();
  exception when others then
    raise warning 'enrichment not queued: %', sqlerrm;
  end;
  return null;
end;
$function$
;
