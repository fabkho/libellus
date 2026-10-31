create policy book_works_readable on public.book_works as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM books b
  WHERE (b.id = book_works.book_id))));
