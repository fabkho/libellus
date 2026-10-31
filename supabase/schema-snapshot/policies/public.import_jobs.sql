create policy import_jobs_own on public.import_jobs as permissive for select to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));
