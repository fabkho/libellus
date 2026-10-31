create policy accounts_select_own on public.accounts as permissive for select to authenticated
  using ((id = ( SELECT auth.uid() AS uid)));
