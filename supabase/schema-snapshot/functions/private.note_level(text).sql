CREATE OR REPLACE FUNCTION private.note_level(p_visibility text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_visibility when 'private' then 0 when 'friends' then 1 when 'public' then 2 end
$function$
;
