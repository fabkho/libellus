CREATE OR REPLACE FUNCTION public.clamp_session_progress(p_entry_id uuid, p_page_count integer)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  update public.reading_sessions
     set progress_page = public.clamp_progress_page(progress_page, p_page_count)
   where entry_id = p_entry_id
     and progress_page is distinct from public.clamp_progress_page(progress_page, p_page_count)
$function$
;
