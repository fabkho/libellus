CREATE OR REPLACE FUNCTION private.import_job_as_caller(p_before text[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  perform set_config('request.jwt.claims', coalesce(p_before[1], ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(p_before[2], ''), true);
  perform set_config('request.jwt.claim.role', coalesce(p_before[3], ''), true);
end
$function$
;
