create policy goodreads_ratings_readable on public.goodreads_ratings as permissive for select to authenticated
  using (true);
