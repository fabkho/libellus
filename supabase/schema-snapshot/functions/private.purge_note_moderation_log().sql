CREATE OR REPLACE FUNCTION private.purge_note_moderation_log()
 RETURNS integer
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  with gone as (
    delete from private.note_moderation_log l where l.removed_at < now() - interval '12 months' returning 1
  )
  select count(*)::integer from gone
$function$
;
