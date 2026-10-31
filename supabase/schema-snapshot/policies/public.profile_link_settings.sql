create policy profile_link_settings_select_own on public.profile_link_settings as permissive for select to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));
