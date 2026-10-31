create policy reading_sessions_own on public.reading_sessions as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM library_entries e
  WHERE ((e.id = reading_sessions.entry_id) AND (e.member_id = ( SELECT auth.uid() AS uid))))));
