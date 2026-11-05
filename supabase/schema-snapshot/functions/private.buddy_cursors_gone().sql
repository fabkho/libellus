CREATE OR REPLACE FUNCTION private.buddy_cursors_gone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  delete from public.buddy_section_cursors c
   using public.buddy_read_sections s
   where s.id = c.section_id and s.buddy_read_id = old.buddy_read_id and c.member_id = old.member_id;
  return null;
end;
$function$
;
