CREATE OR REPLACE FUNCTION private.buddy_host_gate(p_read uuid, p_member uuid)
 RETURNS buddy_reads
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_read public.buddy_reads;
begin
  if (private.buddy_gate(p_read, p_member)).role <> 'host' then
    raise exception 'not_host' using errcode = 'PT403';
  end if;
  select * into v_read from public.buddy_reads where id = p_read;
  return v_read;
end;
$function$
;
