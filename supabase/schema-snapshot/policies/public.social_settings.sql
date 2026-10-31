create policy social_settings_select_own on public.social_settings as permissive for select to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));
