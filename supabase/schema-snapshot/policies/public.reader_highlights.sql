create policy reader_highlights_insert_own on public.reader_highlights as permissive for insert to authenticated
  with check (((member_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM library_entries e
  WHERE ((e.id = reader_highlights.entry_id) AND (e.member_id = ( SELECT auth.uid() AS uid)))))));

create policy reader_highlights_select_own on public.reader_highlights as permissive for select to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));

create policy reader_highlights_update_own on public.reader_highlights as permissive for update to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)))
  with check (((member_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM library_entries e
  WHERE ((e.id = reader_highlights.entry_id) AND (e.member_id = ( SELECT auth.uid() AS uid)))))));
