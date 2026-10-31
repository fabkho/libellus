create policy reading_pages_select_own on public.reading_pages as permissive for select to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));
