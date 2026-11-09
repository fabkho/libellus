create policy avatars_delete_own on storage.objects as permissive for delete to authenticated
  using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));

create policy avatars_insert_own on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'avatars'::text) AND (name ~ (('^'::text || (( SELECT auth.uid() AS uid))::text) || '/[0-9a-f]{32}(-128)?\.(webp|jpg)$'::text))));

create policy avatars_select_connected on storage.objects as permissive for select to authenticated
  using (((bucket_id = 'avatars'::text) AND can_see_member_file(name)));

create policy avatars_select_own on storage.objects as permissive for select to authenticated
  using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));

create policy avatars_update_own on storage.objects as permissive for update to authenticated
  using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)))
  with check (((bucket_id = 'avatars'::text) AND (name ~ (('^'::text || (( SELECT auth.uid() AS uid))::text) || '/[0-9a-f]{32}(-128)?\.(webp|jpg)$'::text))));

create policy buddy_voice_insert_own on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'buddy-voice'::text) AND private.buddy_voice_writable(name)));

create policy buddy_voice_select_members on storage.objects as permissive for select to authenticated
  using (((bucket_id = 'buddy-voice'::text) AND private.buddy_voice_readable(name)));

create policy note_voice_insert_own on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'note-voice'::text) AND private.note_voice_writable(name)));

create policy note_voice_select_author on storage.objects as permissive for select to authenticated
  using (((bucket_id = 'note-voice'::text) AND private.note_voice_readable(name)));
