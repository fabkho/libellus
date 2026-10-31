create policy book_authors_readable on public.book_authors as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM books b
  WHERE (b.id = book_authors.book_id))));
