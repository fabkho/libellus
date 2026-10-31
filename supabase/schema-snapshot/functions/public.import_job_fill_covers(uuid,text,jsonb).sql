CREATE OR REPLACE FUNCTION public.import_job_fill_covers(p_job uuid, p_runner text, p_covers jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_before text[] := private.import_job_as_member(p_job, p_runner);
  v_filled integer;
begin
  v_filled := public.fill_book_covers(p_covers);
  perform private.import_job_as_caller(v_before);
  return v_filled;
end
$function$
;
