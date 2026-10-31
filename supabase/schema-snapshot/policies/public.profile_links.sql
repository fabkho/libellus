create policy profile_links_select_own on public.profile_links as permissive for select to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));
