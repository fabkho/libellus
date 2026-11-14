-- Notes: editing one's own note (docs/plans/book-notes.md; docs/parity.md, "Notes, a chapter").
--
-- A note she wrote may be corrected after it is sent, without deleting it and writing it again: `edit_note` sets its
-- words and stamps `edited_at`, and every screen that draws the note shows "edited" under it. Nothing else about the
-- note changes: its audience, its chapter, the note it answers, its reactions and the instant it was written stay as
-- they are, so the thread's order does not move and a reply keeps answering what it answered. Only a live text note of
-- hers is editable: a tombstone (hers or the owner's) keeps what it is, and a voice note is a recording, not words.
--
-- What this migration adds (nothing here drops a table, a column or an index, and no row is rewritten):
--   column    public.room_messages.edited_at, timestamptz, nullable, no default: null until the note is edited, and
--             the stamp of its last edit after that. Additive only: existing rows keep null, which reads "not edited".
--   RPC       public.edit_note(p_note uuid, p_body text) returns jsonb: the note as its author sees it (the same
--             answer shape as post_note, delete_note and set_note_visibility, through private.note_json), so the app
--             replaces the bubble with what the database says.
--   json      private.note_json answers `editedAt` as well, null for a note that was never edited and for every
--             tombstone. Replaced here (create or replace, same signature, owner, security, search_path and grants);
--             the rest of the body is the one 20261118010000_notes_private_voice.sql left, unchanged.

set local lock_timeout = '5s';

-- -------------------------------------------------------------------------- the column

alter table public.room_messages
  add column edited_at timestamptz;

comment on column public.room_messages.edited_at is
  'When the author last rewrote the note; null while nobody has (and on every row written before editing existed). '
  'Only a live text note can be edited, so a tombstone never carries it and a voice note never has words to change.';

-- -------------------------------------------------------------------------- private.note_json, with editedAt

-- A note as note_messages shows it to this viewer (who may see it: the caller checked), as 20261118010000_notes_private_voice.sql
-- left it, plus `editedAt`: the instant of the last edit, null when there was none and on a tombstone (a removed note has no
-- history to show, and the row it became says nothing of what it said).
create or replace function private.note_json(p_viewer uuid, p_note public.room_messages)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_note.id,
    'sectionId', p_note.section_id,
    'clientId', case when p_note.author_id = p_viewer then p_note.client_id end,
    'author', private.member_card(p_viewer, p_note.author_id),
    'mine', p_note.author_id = p_viewer,
    'body', case when p_note.deleted_at is null then p_note.body end,
    'kind', case when p_note.deleted_at is null then 'note'
                 when p_note.moderated then 'moderated'
                 else 'removed' end,
    'visibility', p_note.visibility,
    'effectiveVisibility', case when p_note.visibility = 'public' and not private.notes_public_enabled()
                                then 'friends' else p_note.visibility end,
    'spoiler', p_note.spoiler,
    'createdAt', p_note.created_at,
    'editedAt', case when p_note.deleted_at is null then p_note.edited_at end,
    'quote', case when p_note.reply_to is not null then private.note_quote(p_viewer, p_note.reply_to) end,
    'reactions', case when p_note.deleted_at is not null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('emoji', x.emoji, 'count', x.n)
                         order by array_position(array['❤️', '😂', '😮', '😢', '🔥', '📚'], x.emoji))
          from (select r.emoji, count(*)::integer as n
                  from public.room_reactions r
                 where r.message_id = p_note.id
                   and (r.member_id = p_viewer or not private.blocked_either(p_viewer, r.member_id))
                 group by r.emoji) x), '[]'::jsonb) end,
    'myReaction', case when p_note.deleted_at is null then
        (select r.emoji from public.room_reactions r where r.message_id = p_note.id and r.member_id = p_viewer) end
  ) || case when p_note.deleted_at is null and p_note.voice_object is not null and p_note.author_id = p_viewer
            then jsonb_build_object('voice', jsonb_build_object(
                   'path', p_note.voice_object,
                   'mime', p_note.voice_mime,
                   'durationMs', p_note.voice_duration_ms,
                   'peaks', to_jsonb(p_note.voice_peaks)))
            else '{}'::jsonb end
$$;

-- -------------------------------------------------------------------------- edit_note

-- Her own note's words, rewritten. Refusals, as stable messages (the client maps by message): not_signed_in 42501;
-- 22023: body_empty (nothing but spaces, as post_note counts it), body_too_long (over 2000 characters),
-- note_not_editable (a voice note has no words, and a tombstone stays one: hers or the owner's, the same refusal);
-- PT404 not_found (no such note, not in a Book's notes, or not hers: another member's note is never found, never
-- refused for being hers). The stamp is the same for two edits inside one transaction (`clock_timestamp`).
--
-- Unlike post_note there is no rate limit and no `notes_need_book` gate: she is correcting what she already wrote in a
-- room she could write in then, and a correction is not a new note. The row is locked for the update, so two edits at
-- once leave the later one's words and its stamp.
create or replace function public.edit_note(p_note uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_row    public.room_messages;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_body is null or p_body !~ '[^[:space:][:cntrl:]\u00a0\u200b]' then
    raise exception 'body_empty' using errcode = '22023';
  end if;
  if char_length(p_body) > 2000 then
    raise exception 'body_too_long' using errcode = '22023';
  end if;

  select m.* into v_row from public.room_messages m join public.rooms r on r.id = m.room_id
   where m.id = p_note and r.kind = 'notes' and m.author_id = v_caller
   for update of m;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if v_row.deleted_at is not null or v_row.kind <> 'text' then
    raise exception 'note_not_editable' using errcode = '22023';
  end if;

  update public.room_messages
     set body = p_body, edited_at = clock_timestamp()
   where id = p_note
  returning * into v_row;
  return private.note_json(v_caller, v_row);
end;
$$;

-- -------------------------------------------------------------------------- grants

revoke all on function private.note_json(uuid, public.room_messages) from public, anon, authenticated;

revoke all on function public.edit_note(uuid, text) from public, anon;
grant execute on function public.edit_note(uuid, text) to authenticated;
