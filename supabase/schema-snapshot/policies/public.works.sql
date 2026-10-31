create policy works_readable on public.works as permissive for select to authenticated
  using (true);
