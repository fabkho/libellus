create policy library_entries_own on public.library_entries as permissive for select to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));
