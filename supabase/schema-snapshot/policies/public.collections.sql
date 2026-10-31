create policy collections_own on public.collections as permissive for select to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));
