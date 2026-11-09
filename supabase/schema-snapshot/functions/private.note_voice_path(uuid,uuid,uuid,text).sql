CREATE OR REPLACE FUNCTION private.note_voice_path(p_room uuid, p_author uuid, p_client uuid, p_mime text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'private'
AS $function$
  select p_author::text || '/' || p_room::text || '/' || p_client::text || '.' || private.buddy_voice_ext(p_mime)
$function$
;
