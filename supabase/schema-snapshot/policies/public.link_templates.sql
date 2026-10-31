create policy link_templates_select_own on public.link_templates as permissive for select to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));
