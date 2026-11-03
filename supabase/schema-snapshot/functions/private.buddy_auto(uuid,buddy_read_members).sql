CREATE OR REPLACE FUNCTION private.buddy_auto(p_read uuid, p_m buddy_read_members)
 RETURNS smallint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_f numeric := private.buddy_fraction(p_m.entry_id, p_m.joined_at);
begin
  if v_f is null then
    return null;
  end if;
  return (select count(*)::smallint from public.buddy_read_sections s
           where s.buddy_read_id = p_read and s.kind = 'part' and s.to_fraction <= v_f + 0.005);
end;
$function$
;
