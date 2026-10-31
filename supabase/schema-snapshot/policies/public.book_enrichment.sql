create policy book_enrichment_readable on public.book_enrichment as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM books b
  WHERE (b.id = book_enrichment.book_id))));
