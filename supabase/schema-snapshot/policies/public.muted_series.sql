create policy muted_series_own on public.muted_series as permissive for select to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));
