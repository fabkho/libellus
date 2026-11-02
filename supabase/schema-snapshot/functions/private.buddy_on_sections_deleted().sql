CREATE OR REPLACE FUNCTION private.buddy_on_sections_deleted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_read uuid;
begin
  for v_read in
    select distinct o.buddy_read_id
      from old_rows o
     where exists (select 1 from public.buddy_reads r where r.id = o.buddy_read_id)
       and exists (select 1 from public.buddy_read_sections s where s.buddy_read_id = o.buddy_read_id)
     order by 1
  loop
    perform private.buddy_refresh_read(v_read);
  end loop;
  return null;
end;
$function$
;
