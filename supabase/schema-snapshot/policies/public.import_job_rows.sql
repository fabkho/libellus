create policy import_job_rows_own on public.import_job_rows as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM import_jobs j
  WHERE ((j.id = import_job_rows.job_id) AND (j.member_id = ( SELECT auth.uid() AS uid))))));
