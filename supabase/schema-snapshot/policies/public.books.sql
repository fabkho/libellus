create policy books_readable on public.books as permissive for select to authenticated
  using (((owner_id = ( SELECT auth.uid() AS uid)) OR ((owner_id IS NULL) AND ((NOT check_failed) OR (EXISTS ( SELECT 1
   FROM library_entries e
  WHERE ((e.member_id = ( SELECT auth.uid() AS uid)) AND (e.book_id = books.id))))))));
