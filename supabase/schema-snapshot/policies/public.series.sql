create policy series_readable on public.series as permissive for select to authenticated
  using (((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid))));
