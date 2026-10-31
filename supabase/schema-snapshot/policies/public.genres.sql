create policy genres_readable on public.genres as permissive for select to authenticated
  using (true);
