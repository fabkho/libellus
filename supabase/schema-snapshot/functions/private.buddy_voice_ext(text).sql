CREATE OR REPLACE FUNCTION private.buddy_voice_ext(p_mime text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case p_mime when 'audio/mp4' then 'm4a' when 'audio/webm' then 'webm' when 'audio/ogg' then 'ogg' end
$function$
;
