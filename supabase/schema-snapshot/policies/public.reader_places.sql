create policy reader_places_insert_own on public.reader_places as permissive for insert to authenticated
  with check (((member_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM library_entries e
  WHERE ((e.id = reader_places.entry_id) AND (e.member_id = ( SELECT auth.uid() AS uid)))))));

create policy reader_places_select_own on public.reader_places as permissive for select to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));

create policy reader_places_update_own on public.reader_places as permissive for update to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)))
  with check (((member_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM library_entries e
  WHERE ((e.id = reader_places.entry_id) AND (e.member_id = ( SELECT auth.uid() AS uid)))))));
