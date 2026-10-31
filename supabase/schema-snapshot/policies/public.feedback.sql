create policy feedback_insert_own on public.feedback as permissive for insert to authenticated
  with check ((member_id = ( SELECT auth.uid() AS uid)));
