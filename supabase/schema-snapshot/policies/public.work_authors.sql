create policy work_authors_readable on public.work_authors as permissive for select to authenticated
  using (true);
