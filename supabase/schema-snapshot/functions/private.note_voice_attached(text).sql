CREATE OR REPLACE FUNCTION private.note_voice_attached(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select exists (select 1 from public.room_messages m where m.voice_object = p_name)
$function$
;
