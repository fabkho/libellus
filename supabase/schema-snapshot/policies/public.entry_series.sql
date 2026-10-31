create policy entry_series_own on public.entry_series as permissive for select to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));
