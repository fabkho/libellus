create policy collection_entries_own on public.collection_entries as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM collections c
  WHERE ((c.id = collection_entries.collection_id) AND (c.member_id = ( SELECT auth.uid() AS uid))))));
