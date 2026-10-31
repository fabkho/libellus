create policy entry_genres_own on public.entry_genres as permissive for select to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));
