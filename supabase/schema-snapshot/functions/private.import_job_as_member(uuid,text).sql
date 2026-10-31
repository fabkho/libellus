CREATE OR REPLACE FUNCTION private.import_job_as_member(p_job uuid, p_runner text)
 RETURNS text[]
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid;
  v_before text[] := array[current_setting('request.jwt.claims', true), current_setting('request.jwt.claim.sub', true),
                           current_setting('request.jwt.claim.role', true)];
begin
  select member_id into v_member from public.import_jobs where id = p_job and state = 'running' and runner = p_runner;
  if v_member is null then raise exception 'lease_lost' using errcode = '55000'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  return v_before;
end
$function$
;
