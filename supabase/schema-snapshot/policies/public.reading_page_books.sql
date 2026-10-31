create policy reading_page_books_select_own on public.reading_page_books as permissive for select to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));
