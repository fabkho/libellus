CREATE OR REPLACE FUNCTION public.voice_sweep_done(p_items jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
  delete from private.buddy_voice_trash t
   using jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) e
   where t.bucket = e ->> 'bucket' and t.path = e ->> 'path'
$function$
;
