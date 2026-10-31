CREATE OR REPLACE FUNCTION public.collection_entries_same_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if not exists (
    select 1 from public.collections c
      join public.library_entries e on e.member_id = c.member_id
     where c.id = new.collection_id and e.id = new.entry_id
  ) then
    raise exception 'entry_missing' using errcode = '23503';
  end if;
  return new;
end;
$function$
;
