create policy work_series_readable on public.work_series as permissive for select to authenticated
  using (true);
