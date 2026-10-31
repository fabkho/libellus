create policy authors_readable on public.authors as permissive for select to authenticated
  using (true);
