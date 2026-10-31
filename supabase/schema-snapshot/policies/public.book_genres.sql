create policy book_genres_readable on public.book_genres as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM books b
  WHERE (b.id = book_genres.book_id))));
