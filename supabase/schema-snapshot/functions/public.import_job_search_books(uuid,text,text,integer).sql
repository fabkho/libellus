CREATE OR REPLACE FUNCTION public.import_job_search_books(p_job uuid, p_runner text, p_query text, p_limit integer DEFAULT 20)
 RETURNS SETOF books
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_before text[] := private.import_job_as_member(p_job, p_runner);
  v_member uuid := (select member_id from public.import_jobs where id = p_job);
begin
  return query
    select b.*
      from public.search_books(p_query, p_limit) b
     where b.owner_id = v_member
        or (b.owner_id is null
            and (not b.check_failed
                 or exists (select 1 from public.library_entries e where e.member_id = v_member and e.book_id = b.id)));
  perform private.import_job_as_caller(v_before);
end
$function$
;
