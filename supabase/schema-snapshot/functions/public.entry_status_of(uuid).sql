CREATE OR REPLACE FUNCTION public.entry_status_of(p_entry_id uuid)
 RETURNS entry_status
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select case
    when exists (select 1 from public.reading_sessions where entry_id = p_entry_id and outcome is null)
      then 'reading'
    when exists (select 1 from public.reading_sessions where entry_id = p_entry_id)
      then 'finished'
    else 'want_to_read'
  end::public.entry_status
$function$
;
