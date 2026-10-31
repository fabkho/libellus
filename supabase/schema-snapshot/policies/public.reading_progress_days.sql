create policy reading_progress_days_own on public.reading_progress_days as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM (reading_sessions s
     JOIN library_entries e ON ((e.id = s.entry_id)))
  WHERE ((s.id = reading_progress_days.session_id) AND (e.member_id = ( SELECT auth.uid() AS uid))))));
