-- Notes: voice notes, for your own private notes (docs/plans/book-notes.md; docs/parity.md, "Notes, a chapter").
--
-- A voice note is the author's own spoken notebook for a chapter: she records it in a Notes thread at "Only me" and
-- nobody else, ever, can hear it or even know it exists. Friends and Everyone notes never carry a voice. It is
-- one row of public.room_messages (kind 'voice', visibility always 'private'), so the rule that decides who sees
-- a note (private.can_see_note, private.visible_notes: a private note is its author's alone, decided before any
-- block or follow is asked) is the rule for a voice note too, with no second path: the thread, the chapter counts,
-- unread, faces, the Book page lines, quotes, reactions, reports and the block guard all go through it. What is new is
-- only where the sound lives, and the refusal to ever widen it.
--
-- What this migration adds (nothing it does drops a table, a column or an index; two checks are replaced, see below):
--   columns   public.room_messages.voice_object, voice_mime ('audio/mp4' | 'audio/webm' | 'audio/ogg'),
--             voice_duration_ms (1 - 120000) and voice_peaks (up to 48 values 0 - 100). Four nullable columns
--             without a default: no table rewrite. voice_object is the object's name in the bucket,
--             `<author id>/<room id>/<client id>.<m4a|webm|ogg>`; the shape check pins it to the row's own ids and
--             type, so it can never name anybody else's object.
--   checks    room_messages_kind gains 'voice'; room_messages_shape says which columns a voice note carries (and that
--             a tombstone keeps none); room_messages_voice_private: a voice note is private, whatever sets its level.
--             The two old checks are dropped and the new ones added in this one transaction, so the table is locked
--             ACCESS EXCLUSIVE from the ADD COLUMN until the commit and the new checks scan it once under that lock
--             (the tables have held notes since 1.40 and are small); `lock_timeout` of 5 s makes the migration fail
--             and roll back, rather than queue every reader and writer behind it, should something hold the table.
--   bucket    `note-voice`, PRIVATE (no public URL, ever), 3 MB an object, the same three types as `buddy-voice`.
--   policies  on storage.objects: select ONLY for the author of a live, private, voice note that points at the
--             object (nobody else, not her friends, not the owner of the instance, not a blocked member: nobody);
--             insert ONLY into her own folder of a Notes room of a Book she has, at most 20 objects an hour. No update
--             and no delete policy: no member deletes an object, the database's sweep does.
--   helpers   private.note_voice_path, note_voice_parts, note_voice_readable, note_voice_writable,
--             note_voice_attached, note_voice_gone (trigger), voice_sweep_pick.
--   RPCs      post_note_voice (the posting, private only); voice_sweep_batch / voice_sweep_done (service role only,
--             for the Edge Function `buddy-voice-sweep`, which now sweeps both buckets).
--   trash     the queue private.buddy_voice_trash gains `bucket` ('buddy-voice' by default, so every existing row and
--             every existing writer keeps its meaning) and its key becomes (bucket, path): a path is only unique
--             within its bucket. The two buddy RPCs buddy_voice_sweep_batch / buddy_voice_sweep_done are replaced
--             (same signatures, grants and security) to look at the `buddy-voice` rows only: an Edge Function of
--             the old version, which can only remove from `buddy-voice`, must never be handed (and then forget) a
--             note-voice path. The cron jobs of the buddy sweep are unchanged: they ask the one function.
--   changes   six shipped Notes functions, additively (create or replace, same signature, owner, security,
--             search_path and grants; the rest of the body copied unchanged): private.room_messages_check (the voice
--             rule, a note never changes kind), private.note_quote (a voice note's quote says so), private.note_json
--             (the voice object, for its author only), post_note (a retry of a voice note's client id is
--             client_id_reused), set_note_visibility (refuses to widen a voice note: voice_private_only),
--             delete_note and owner_remove_note (the tombstone keeps no audio: the trigger queues the object).
--
-- Who may hear what. A voice note's object is read through a short-lived signed URL the app asks for when she
-- presses play (`createSignedUrl`, 5 minutes): Storage checks the select policy below when it signs it, and the
-- policy lets exactly one member through, the author, for a row that is live, of kind voice and private. A
-- friend, a member of Everyone, a stranger, a blocked member, the owner and a signed-out caller get nothing, and a
-- name that is not hers is not even looked up. The note row says it is a voice note (and the object's name) only to
-- its author (private.note_json); to anybody else the note is not there at all: not in the thread, in no count, no
-- face, no summary line, and a reply or a quote of it is hidden. Nothing sends the object's name, the duration or the
-- waveform anywhere else: no Realtime (Notes has none), no report excerpt (a report needs a note the reporter can see),
-- no moderation log beyond the words "voice note".
--
-- No audio outlives its note. An object is queued for removal (private.buddy_voice_trash, bucket 'note-voice', by
-- trigger) when its note row is deleted (the author's account deleted: the foreign key cascades and the trigger
-- fires for every row) or becomes a tombstone (her own delete, the owner's removal). The database cannot remove a
-- file itself (Storage's protect_delete), so the Edge Function `buddy-voice-sweep` removes the queued objects of both
-- buckets through the Storage API and, on its hourly run, objects of either bucket that no row points at and
-- that are older than 6 hours (an upload whose note never came), exactly as for buddy voice. The same kick, the same
-- debounce, the same queue discipline (5 minutes times the attempts, 20 at most).
--
-- Refusals of post_note_voice, as stable messages (the client maps by message): not_signed_in 42501; not_found PT404
-- (no such room or chapter); notes_need_book PT403; client_id_reused PT409; rate_limited PT429 (the 30 a minute and
-- 300 a day of every note, and 10 voice notes a minute and 100 a day); 22023: client_id_required, voice_invalid
-- (type, length, waveform, or an object name that is not hers), voice_missing (no object at its name),
-- voice_too_large, reply_not_visible (a reply only to her own live private note of the same chapter). Of
-- set_note_visibility: voice_private_only 22023 (she asked to widen a voice note).
--
-- Safe on a live database: additive nullable columns, a bucket row, policies, new functions, a column with a
-- constant default on the small queue table, and the replaced functions; no data is rewritten and no table is
-- locked beyond room_messages and the queue (above).

set local lock_timeout = '5s';

-- -------------------------------------------------------------------------- columns and checks

alter table public.room_messages
  add column voice_object      text,
  add column voice_mime        text,
  add column voice_duration_ms integer,
  add column voice_peaks       smallint[];

comment on column public.room_messages.voice_object is
  'kind voice: the object in the private bucket note-voice, <author>/<room>/<client id>.<m4a|webm|ogg>; only its author is ever told. Null otherwise and on a tombstone.';
comment on column public.room_messages.voice_mime is
  'kind voice: the type it was recorded in (audio/mp4, audio/webm or audio/ogg). Null otherwise and on a tombstone.';
comment on column public.room_messages.voice_duration_ms is
  'kind voice: how long it plays, 1 - 120000 ms. Null otherwise and on a tombstone.';
comment on column public.room_messages.voice_peaks is
  'kind voice: the waveform the bubble draws, up to 48 values 0 - 100. Null otherwise, when the phone sent none and on a tombstone.';

alter table public.room_messages drop constraint room_messages_kind_check;
alter table public.room_messages drop constraint room_messages_shape;

alter table public.room_messages
  add constraint room_messages_kind check (kind in ('text', 'voice'));

-- A tombstone keeps nothing it said (no audio either); a live text has 1..2000 characters with something visible and no
-- voice column; a voice note has no words, a type, a length, (maybe) a waveform and the object named after its own ids.
alter table public.room_messages
  add constraint room_messages_shape check (coalesce(
    case
      when deleted_at is not null
        then body = '' and voice_object is null and voice_mime is null and voice_duration_ms is null and voice_peaks is null
      when kind = 'text'
        then char_length(body) between 1 and 2000 and body ~ '[^[:space:][:cntrl:]\u00a0\u200b]'
             and voice_object is null and voice_mime is null and voice_duration_ms is null and voice_peaks is null
      when kind = 'voice'
        then body = ''
             and voice_mime in ('audio/mp4', 'audio/webm', 'audio/ogg')
             and voice_object = author_id::text || '/' || room_id::text || '/' || client_id::text || '.'
                                || case voice_mime when 'audio/mp4' then 'm4a' when 'audio/webm' then 'webm' else 'ogg' end
             and voice_duration_ms between 1 and 120000
             and (voice_peaks is null or (cardinality(voice_peaks) between 1 and 48
                                          and 0 <= all (voice_peaks) and 100 >= all (voice_peaks)))
      else false
    end, false));

-- A voice note is private, always: Only me is the one level a recording has (the trigger says why, this is the backstop).
alter table public.room_messages
  add constraint room_messages_voice_private check (kind <> 'voice' or visibility = 'private');

comment on table public.room_messages is
  'Rooms: messages. In a notes room each note has its own visibility (private | friends | public; '
  'members is a buddy room''s), decided for every read by private.can_see_note. A reply is never wider '
  'than the note it answers. A tombstone (deleted_at) keeps its level and nothing it said; moderated = '
  'removed by the owner (the text is in private.note_moderation_log). kind voice (20261118010000): the author''s own '
  'spoken note, always private, the sound an object in the private bucket note-voice (voice_*); only its author ever sees it.';

-- -------------------------------------------------------------------------- the bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('note-voice', 'note-voice', false, 3 * 1024 * 1024, array['audio/mp4', 'audio/webm', 'audio/ogg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -------------------------------------------------------------------------- names

-- The object of a voice note: `<author>/<room>/<client id>.<ext>`. One name per (author, client id), which is unique, so a
-- retried post cannot make a second object. (The extension is private.buddy_voice_ext's: the same three types.)
create or replace function private.note_voice_path(p_room uuid, p_author uuid, p_client uuid, p_mime text)
returns text
language sql
immutable
set search_path = pg_catalog, private
as $$
  select p_author::text || '/' || p_room::text || '/' || p_client::text || '.' || private.buddy_voice_ext(p_mime)
$$;

-- A name in the bucket: `<author>/<room>/<client id>.<ext>`, lower-case uuids. The parts, or null.
create or replace function private.note_voice_parts(p_name text)
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select regexp_match(p_name,
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(m4a|webm|ogg)$')
$$;

-- -------------------------------------------------------------------------- the trash queue gains its bucket

alter table private.buddy_voice_trash
  add column bucket text not null default 'buddy-voice' check (bucket in ('buddy-voice', 'note-voice'));

alter table private.buddy_voice_trash drop constraint buddy_voice_trash_pkey;
alter table private.buddy_voice_trash add primary key (bucket, path);

comment on table private.buddy_voice_trash is
  'Voice objects whose message or note is gone (deleted, a tombstone, its author''s account deleted) or that nothing ever pointed at: removed from storage by the Edge Function buddy-voice-sweep, then forgotten here. bucket: buddy-voice (a buddy read''s) or note-voice (a private voice note''s). attempts: how often the function was handed the path (20 is the last).';

-- -------------------------------------------------------------------------- the trigger: a voice note's object goes to the trash

-- A voice note's row went (deleted by a cascade: her account), or is a tombstone now: its object is queued, and the function is asked
-- once per transaction (the kick of buddy voice, and the same debounce), however many rows that were.
create or replace function private.note_voice_gone()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  insert into private.buddy_voice_trash (bucket, path)
  values ('note-voice', old.voice_object)
  on conflict do nothing;
  if coalesce(current_setting('buddy_voice.kicked', true), '') <> 'on' then
    perform set_config('buddy_voice.kicked', 'on', true);
    perform private.buddy_voice_kick();
  end if;
  return null;
exception when others then
  -- Never costs the delete or the account its success; the hourly job finds the object by the sweep's second rule (the uploads nobody sent).
  raise warning 'note-voice: object of note % not queued: %', old.id, sqlerrm;
  return null;
end;
$$;

create trigger room_messages_voice_deleted
  after delete on public.room_messages
  for each row when (old.voice_object is not null)
  execute function private.note_voice_gone();

create trigger room_messages_voice_tombstone
  after update of voice_object on public.room_messages
  for each row when (old.voice_object is not null and new.voice_object is null)
  execute function private.note_voice_gone();

-- -------------------------------------------------------------------------- the bucket's policies

-- The select policy: the caller is the author the name says, and a live voice note of hers, at Only me, points at the name. Nobody
-- else: there is no branch for a friend, Everyone, a room member or the owner. A tombstone points at nothing, so its object cannot be
-- signed even before the sweep has removed it.
create or replace function private.note_voice_readable(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_parts  text[] := private.note_voice_parts(p_name);
begin
  if v_caller is null or v_parts is null or v_parts[1] <> v_caller::text then
    return false;
  end if;
  return exists (select 1 from public.room_messages m
                   join public.rooms r on r.id = m.room_id
                  where m.author_id = v_caller and m.voice_object = p_name
                    and m.kind = 'voice' and m.deleted_at is null and m.visibility = 'private'
                    and r.kind = 'notes');
end;
$$;

-- The insert policy: her own folder, a Notes room (the name's second part) of a Book she has (the rule of post_note), at most 20
-- objects an hour (the post limits count notes, and an upload comes before its note; 20 x 3 MB a member an hour is the most that can
-- wait, unsent, for the sweep).
create or replace function private.note_voice_writable(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_parts  text[] := private.note_voice_parts(p_name);
begin
  if v_caller is null or v_parts is null or v_parts[1] <> v_caller::text then
    return false;
  end if;
  if not exists (select 1 from public.rooms r
                  where r.id = v_parts[2]::uuid and r.kind = 'notes' and private.has_work(v_caller, r.work_key)) then
    return false;
  end if;
  return (select count(*) from storage.objects o
           where o.bucket_id = 'note-voice' and o.owner_id = v_caller::text
             and o.created_at > now() - interval '1 hour') < 20;
end;
$$;

-- The policies run as the member: Postgres checks EXECUTE on a function they hold, not the schema, so private stays closed.
revoke all on function private.note_voice_readable(text) from public, anon, authenticated;
revoke all on function private.note_voice_writable(text) from public, anon, authenticated;
grant execute on function private.note_voice_readable(text) to authenticated;
grant execute on function private.note_voice_writable(text) to authenticated;

create policy note_voice_select_author on storage.objects
  for select to authenticated
  using (bucket_id = 'note-voice' and private.note_voice_readable(name));

create policy note_voice_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'note-voice' and private.note_voice_writable(name));

-- -------------------------------------------------------------------------- the trigger of a note's rules

-- private.room_messages_check as 20261116010000_book_notes.sql left it, plus: a voice note is private (voice_private_only: the
-- function says it first, the check is the backstop) and a note never changes its kind.
create or replace function private.room_messages_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind   text;
  v_parent public.room_messages;
begin
  select r.kind into v_kind from public.rooms r where r.id = new.room_id;

  if tg_op = 'UPDATE' and new.kind is distinct from old.kind then
    raise exception 'room_message_invalid: a note does not change its kind' using errcode = '23514';
  end if;

  if v_kind = 'notes' then
    if new.visibility = 'members' then
      raise exception 'room_message_invalid: a note is private, friends or public' using errcode = '23514';
    end if;
    if new.section_id is null then
      raise exception 'room_message_invalid: a note is in a chapter' using errcode = '23514';
    end if;
    if new.kind = 'voice' and new.visibility <> 'private' then
      raise exception 'voice_private_only' using errcode = '23514';
    end if;
  elsif new.visibility <> 'members' then
    raise exception 'room_message_invalid: a buddy message is for its members' using errcode = '23514';
  elsif new.kind = 'voice' then
    raise exception 'room_message_invalid: a buddy room''s voice is a buddy message' using errcode = '23514';
  end if;

  if new.section_id is not null
     and not exists (select 1 from public.room_sections s where s.id = new.section_id and s.room_id = new.room_id) then
    raise exception 'room_message_invalid: the Section is of another room' using errcode = '23514';
  end if;

  if new.reply_to is not null
     and (tg_op = 'INSERT' or new.reply_to is distinct from old.reply_to
          or new.visibility is distinct from old.visibility
          or new.room_id is distinct from old.room_id or new.section_id is distinct from old.section_id) then
    select * into v_parent from public.room_messages p where p.id = new.reply_to;
    if v_parent.room_id is distinct from new.room_id or v_parent.section_id is distinct from new.section_id then
      raise exception 'room_message_invalid: a reply stays in its thread' using errcode = '23514';
    end if;
    if (new.visibility = 'members') <> (v_parent.visibility = 'members')
       or private.note_level(new.visibility) > private.note_level(v_parent.visibility) then
      raise exception 'note_wider_than_parent' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- -------------------------------------------------------------------------- a note as the API answers it

-- The quote of the note a reply answers, as 20261116010000_book_notes.sql left it, plus `voice`: true for a voice note (it has no words; the app
-- says "Voice message"). Only its author can see one, so only she is ever shown this quote: everybody else gets { "hidden": true }.
create or replace function private.note_quote(p_viewer uuid, p_parent uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
           when m.id is null then null
           when not private.can_see_note(p_viewer, m.id) then jsonb_build_object('hidden', true)
           when m.deleted_at is not null then jsonb_build_object('removed', true)
           else jsonb_build_object('id', m.id,
                                   'author', private.member_card(p_viewer, m.author_id),
                                   'excerpt', left(m.body, 140),
                                   'spoiler', m.spoiler,
                                   'voice', m.voice_object is not null)
         end
    from (select 1) one
    left join public.room_messages m on m.id = p_parent
$$;

-- A note as note_messages shows it to this viewer (who may see it: the caller checked), as 20261116010000_book_notes.sql left it, plus `voice`
-- {path, mime, durationMs, peaks} for a live voice note **and only to its author**: nobody else is ever asked this, and if one were,
-- the key would still be missing.
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

-- -------------------------------------------------------------------------- post_note_voice

-- Post a voice note she has uploaded: p_object is the object's name (it must be exactly
-- private.note_voice_path(p_room, her, p_client_id, p_mime): hers, in this room, of that type), p_mime its type, p_duration_ms how long it
-- plays (1 - 120000), p_peaks the waveform (up to 48 values 0 - 100, null for none). The object must be there already, of that type and at
-- most 3 MB. There is no visibility parameter: it is private, always. p_reply_to answers her own live private note of the same chapter,
-- nobody else's (a voice note is nobody's to answer but hers). Idempotent on (her, p_client_id) like post_note: the same call again answers
-- the note it made; the same client id for another room, chapter or kind is client_id_reused. The rules are post_note's (same locks, same
-- order, same limits over all her notes) and a voice note is counted against its own 10 a minute and 100 a day as well.
create or replace function public.post_note_voice(
  p_room        uuid,
  p_section     uuid,
  p_client_id   uuid,
  p_object      text,
  p_mime        text,
  p_duration_ms integer,
  p_peaks       smallint[],
  p_reply_to    uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_room   public.rooms;
  v_row    public.room_messages;
  v_parent public.room_messages;
  v_path   text;
  v_object jsonb;
  v_size   bigint;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'client_id_required' using errcode = '22023';
  end if;
  if private.buddy_voice_ext(p_mime) is null
     or p_duration_ms is null or p_duration_ms not between 1 and 120000
     or (p_peaks is not null and (cardinality(p_peaks) not between 1 and 48
                                  or array_position(p_peaks, null) is not null
                                  or 0 > any (p_peaks) or 100 < any (p_peaks))) then
    raise exception 'voice_invalid' using errcode = '22023';
  end if;

  perform private.notes_lock('notes', v_caller::text);

  -- A retry: the note it made (as she sees it now), before the gate.
  select * into v_row from public.room_messages m where m.author_id = v_caller and m.client_id = p_client_id;
  if found then
    if v_row.room_id is distinct from p_room or v_row.section_id is distinct from p_section or v_row.kind <> 'voice' then
      raise exception 'client_id_reused' using errcode = 'PT409';
    end if;
    return private.note_json(v_caller, v_row);
  end if;

  select * into v_room from public.rooms r where r.id = p_room and r.kind = 'notes';
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if not private.has_work(v_caller, v_room.work_key) then
    raise exception 'notes_need_book' using errcode = 'PT403';
  end if;

  -- The room's lock: the chapter, the parent and the thread's newest time are read after it.
  perform private.notes_lock('notes_room', p_room::text);
  if not exists (select 1 from public.room_sections s where s.id = p_section and s.room_id = p_room) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  -- The name is hers, in this room, for this client id and type: never another member's object.
  v_path := private.note_voice_path(p_room, v_caller, p_client_id, p_mime);
  if p_object is distinct from v_path then
    raise exception 'voice_invalid' using errcode = '22023';
  end if;

  -- A reply: only to her own live private note of the same chapter.
  if p_reply_to is not null then
    select * into v_parent from public.room_messages m where m.id = p_reply_to;
    if not found or v_parent.room_id <> p_room or v_parent.section_id is distinct from p_section
       or v_parent.deleted_at is not null or v_parent.author_id <> v_caller or v_parent.visibility <> 'private' then
      raise exception 'reply_not_visible' using errcode = '22023';
    end if;
  end if;

  -- The object: there, of the type said, not empty, not over the bucket's 3 MB.
  select o.metadata into v_object from storage.objects o where o.bucket_id = 'note-voice' and o.name = v_path;
  if not found then
    raise exception 'voice_missing' using errcode = '22023';
  end if;
  -- The type Storage kept, without its parameters: a browser's recorder says "audio/webm;codecs=opus" and Storage keeps what it is sent.
  if lower(btrim(split_part(coalesce(v_object ->> 'mimetype', ''), ';', 1))) is distinct from p_mime then
    raise exception 'voice_invalid' using errcode = '22023';
  end if;
  v_size := coalesce(nullif(v_object ->> 'size', '')::bigint, 0);
  if v_size > 3 * 1024 * 1024 then
    raise exception 'voice_too_large' using errcode = '22023';
  end if;
  if v_size < 1 then
    raise exception 'voice_invalid' using errcode = '22023';
  end if;

  -- 30 a minute and 300 a day over all Books, as post_note. Under her member lock.
  if (select count(*) from public.room_messages m
       where m.author_id = v_caller and m.created_at > clock_timestamp() - interval '1 minute') >= 30
     or (select count(*) from public.room_messages m
          where m.author_id = v_caller and m.created_at > clock_timestamp() - interval '1 day') >= 300 then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  -- And a voice note's own, which keeps the bucket small: 10 a minute, 100 a day.
  perform private.note_rate(v_caller, 'voice', 10, interval '1 minute');
  perform private.note_rate(v_caller, 'voice_day', 100, interval '1 day');

  insert into public.room_messages (room_id, section_id, author_id, client_id, kind, body, reply_to, visibility,
                                    voice_object, voice_mime, voice_duration_ms, voice_peaks, created_at)
  values (p_room, p_section, v_caller, p_client_id, 'voice', '', p_reply_to, 'private',
          v_path, p_mime, p_duration_ms, p_peaks,
          greatest(clock_timestamp(),
                   (select max(m.created_at) + interval '1 microsecond'
                      from public.room_messages m where m.section_id = p_section)))
  returning * into v_row;
  return private.note_json(v_caller, v_row);
end;
$$;

-- -------------------------------------------------------------------------- post_note: never a voice note

-- As 20261116010000_book_notes.sql left it, plus: a retry whose client id made a voice note is client_id_reused (post_note makes text notes
-- only; it has no kind parameter, so a voice note is made by post_note_voice and nothing else).
create or replace function public.post_note(p_room uuid, p_section uuid, p_client_id uuid, p_body text,
                                            p_visibility text, p_reply_to uuid default null,
                                            p_spoiler boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_room   public.rooms;
  v_row    public.room_messages;
  v_parent public.room_messages;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'client_id_required' using errcode = '22023';
  end if;
  if p_visibility is null or p_visibility not in ('private', 'friends', 'public') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;
  if p_body is null or p_body !~ '[^[:space:][:cntrl:]\u00a0\u200b]' then
    raise exception 'body_empty' using errcode = '22023';
  end if;
  if char_length(p_body) > 2000 then
    raise exception 'body_too_long' using errcode = '22023';
  end if;

  perform private.notes_lock('notes', v_caller::text);

  -- A retry: the note it made (as she sees it now). A voice note's client id is not a text's: post_note never answers (or makes) one.
  select * into v_row from public.room_messages m where m.author_id = v_caller and m.client_id = p_client_id;
  if found then
    if v_row.room_id is distinct from p_room or v_row.section_id is distinct from p_section or v_row.kind <> 'text' then
      raise exception 'client_id_reused' using errcode = 'PT409';
    end if;
    return private.note_json(v_caller, v_row);
  end if;

  select * into v_room from public.rooms r where r.id = p_room and r.kind = 'notes';
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if not private.has_work(v_caller, v_room.work_key) then
    raise exception 'notes_need_book' using errcode = 'PT403';
  end if;
  if p_visibility = 'public' and not private.notes_public_enabled() then
    raise exception 'notes_public_off' using errcode = 'PT409';
  end if;

  -- The room's lock: the chapter, the parent's level and the thread's newest time are read after it.
  perform private.notes_lock('notes_room', p_room::text);
  if not exists (select 1 from public.room_sections s where s.id = p_section and s.room_id = p_room) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if p_reply_to is not null then
    select * into v_parent from public.room_messages m where m.id = p_reply_to;
    if not found or v_parent.room_id <> p_room or v_parent.section_id is distinct from p_section
       or v_parent.deleted_at is not null or not private.can_see_note(v_caller, v_parent.id) then
      raise exception 'reply_not_visible' using errcode = '22023';
    end if;
    if private.note_level(p_visibility) > private.note_level(v_parent.visibility) then
      raise exception 'note_wider_than_parent' using errcode = '22023';
    end if;
  end if;

  -- 30 a minute and 300 a day over all Books. Under her member lock.
  if (select count(*) from public.room_messages m
       where m.author_id = v_caller and m.created_at > clock_timestamp() - interval '1 minute') >= 30
     or (select count(*) from public.room_messages m
          where m.author_id = v_caller and m.created_at > clock_timestamp() - interval '1 day') >= 300 then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  -- Every move to Everyone is one use of her 30 a day (a post here, a widening in set_note_visibility).
  if p_visibility = 'public' then
    perform private.note_rate(v_caller, 'public', 30, interval '24 hours');
  end if;

  insert into public.room_messages (room_id, section_id, author_id, client_id, body, reply_to, spoiler,
                                    visibility, created_at)
  values (p_room, p_section, v_caller, p_client_id, p_body, p_reply_to, coalesce(p_spoiler, false),
          p_visibility,
          greatest(clock_timestamp(),
                   (select max(m.created_at) + interval '1 microsecond'
                      from public.room_messages m where m.section_id = p_section)))
  returning * into v_row;
  return private.note_json(v_caller, v_row);
end;
$$;

-- -------------------------------------------------------------------------- set_note_visibility: a voice note is never widened

-- As 20261116010000_book_notes.sql left it, plus: a voice note answers voice_private_only to anything but Only me (it is private already, so
-- asking for private again is no change). Said before anything is read or locked beyond her own row.
create or replace function public.set_note_visibility(p_note uuid, p_visibility text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_row    public.room_messages;
  v_parent text;
  v_level  integer := private.note_level(p_visibility);
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_level is null then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;
  select m.* into v_row from public.room_messages m join public.rooms r on r.id = m.room_id
   where m.id = p_note and r.kind = 'notes' and m.author_id = v_caller and m.deleted_at is null;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if v_row.kind = 'voice' and p_visibility <> 'private' then
    raise exception 'voice_private_only' using errcode = '22023';
  end if;

  perform private.notes_lock('notes_room', v_row.room_id::text);
  select m.* into v_row from public.room_messages m where m.id = p_note for update;
  if v_row.deleted_at is not null then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  if v_level < private.note_level(v_row.visibility) then
    -- Narrowing: the replies first (each to the narrower of its level and the new one), then the note.
    with recursive d as (
      select m.id from public.room_messages m where m.reply_to = p_note
      union
      select m.id from public.room_messages m join d on m.reply_to = d.id
    )
    update public.room_messages m set visibility = p_visibility
      from d
     where m.id = d.id and private.note_level(m.visibility) > v_level;
  elsif v_level > private.note_level(v_row.visibility) then
    if p_visibility = 'public' and not private.notes_public_enabled() then
      raise exception 'notes_public_off' using errcode = 'PT409';
    end if;
    select p.visibility into v_parent from public.room_messages p where p.id = v_row.reply_to;
    if v_parent is not null and v_level > private.note_level(v_parent) then
      raise exception 'note_wider_than_parent' using errcode = '22023';
    end if;
    -- Every move to Everyone is one use of her 30 a day, whenever the note was written: narrowing and
    -- widening again uses another.
    if p_visibility = 'public' then
      perform private.note_rate(v_caller, 'public', 30, interval '24 hours');
    end if;
  end if;

  update public.room_messages set visibility = p_visibility where id = p_note and visibility <> p_visibility
  returning * into v_row;
  if not found then
    select * into v_row from public.room_messages m where m.id = p_note;
  end if;
  return private.note_json(v_caller, v_row);
end;
$$;

-- -------------------------------------------------------------------------- delete_note, owner_remove_note: a tombstone keeps no audio

-- As 20261116010000_book_notes.sql left it, and the tombstone clears the voice columns too: the trigger queues the object.
create or replace function public.delete_note(p_note uuid)
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
  select m.* into v_row from public.room_messages m join public.rooms r on r.id = m.room_id
   where m.id = p_note and r.kind = 'notes' and m.author_id = v_caller
   for update of m;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if v_row.deleted_at is null then
    delete from public.room_reactions where message_id = p_note;
    update public.room_messages
       set body = '', voice_object = null, voice_mime = null, voice_duration_ms = null, voice_peaks = null,
           deleted_at = clock_timestamp(), deleted_by = v_caller
     where id = p_note
    returning * into v_row;
  end if;
  return private.note_json(v_caller, v_row);
end;
$$;

-- As 20261116010000_book_notes.sql left it, and the tombstone clears the voice columns (its record says "voice note", never the sound).
create or replace function public.owner_remove_note(p_note uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, ''), E' \t\n\r'), '');
  v_row    public.room_messages;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) > 1000 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  select m.* into v_row from public.room_messages m join public.rooms r on r.id = m.room_id
   where m.id = p_note and r.kind = 'notes'
   for update of m;
  if not found or v_row.deleted_at is not null then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  insert into private.note_moderation_log (message_id, room_id, author_id, removed_by, reason, body, visibility)
  values (v_row.id, v_row.room_id, v_row.author_id, v_caller, v_reason,
          case when v_row.kind = 'voice' then '[voice note, ' || round(v_row.voice_duration_ms / 1000.0)::integer || ' s]' else v_row.body end,
          v_row.visibility);
  delete from public.room_reactions where message_id = p_note;
  update public.room_messages
     set body = '', voice_object = null, voice_mime = null, voice_duration_ms = null, voice_peaks = null,
         deleted_at = clock_timestamp(), deleted_by = v_caller, moderated = true
   where id = p_note;
  return jsonb_build_object('removed', true);
end;
$$;

-- -------------------------------------------------------------------------- the sweep (service role only), both buckets

-- Whether a live voice note points at this object's name.
create or replace function private.note_voice_attached(p_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (select 1 from public.room_messages m where m.voice_object = p_name)
$$;

-- What the sweep hands the Edge Function, for the buckets asked: the queue (objects of deleted notes and messages), the ones tried least
-- first; a path waits 5 minutes times the tries it has had before it is handed out again and is left alone after 20. With p_orphans (the
-- hourly run) it first queues, at most p_limit a bucket, the objects of each bucket no row points at that are older than p_grace (6
-- hours: a younger one may be an upload whose message is on its way). Never an object a live row points at; a queued path whose object is
-- gone or whose row came back is forgotten. As an array of {bucket, path}, oldest first. (The body of buddy_voice_sweep_batch of
-- 20261114020000_buddy_voice.sql for each bucket, in one place.)
create or replace function private.voice_sweep_pick(p_buckets text[], p_limit integer, p_grace interval, p_orphans boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_out   jsonb;
begin
  if coalesce(p_orphans, false) then
    if 'buddy-voice' = any (p_buckets) then
      insert into private.buddy_voice_trash (bucket, path)
      select 'buddy-voice', o.name
        from storage.objects o
       where o.bucket_id = 'buddy-voice'
         and o.created_at < now() - p_grace
         and not exists (select 1 from private.buddy_voice_trash t where t.bucket = 'buddy-voice' and t.path = o.name)
         and not private.buddy_voice_attached(o.name)
       limit v_limit
      on conflict do nothing;
    end if;
    if 'note-voice' = any (p_buckets) then
      insert into private.buddy_voice_trash (bucket, path)
      select 'note-voice', o.name
        from storage.objects o
       where o.bucket_id = 'note-voice'
         and o.created_at < now() - p_grace
         and not exists (select 1 from private.buddy_voice_trash t where t.bucket = 'note-voice' and t.path = o.name)
         and not private.note_voice_attached(o.name)
       limit v_limit
      on conflict do nothing;
    end if;
  end if;

  delete from private.buddy_voice_trash t
   where t.bucket = any (p_buckets)
     and ((t.bucket = 'buddy-voice' and private.buddy_voice_attached(t.path))
          or (t.bucket = 'note-voice' and private.note_voice_attached(t.path))
          or not exists (select 1 from storage.objects o where o.bucket_id = t.bucket and o.name = t.path));

  with picked as (
    select t.bucket, t.path
      from private.buddy_voice_trash t
     where t.bucket = any (p_buckets)
       and t.attempts < 20
       and (t.last_attempt_at is null or t.last_attempt_at < now() - t.attempts * interval '5 minutes')
     order by t.attempts, t.queued_at
     limit v_limit
       for update skip locked
  ), marked as (
    update private.buddy_voice_trash t
       set attempts = t.attempts + 1, last_attempt_at = now()
      from picked
     where t.bucket = picked.bucket and t.path = picked.path
    returning t.bucket, t.path, t.queued_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('bucket', m.bucket, 'path', m.path) order by m.queued_at, m.path), '[]'::jsonb)
    into v_out from marked m;
  return v_out;
end;
$$;

-- For the Edge Function buddy-voice-sweep (this version): the objects of both buckets to remove now, [{bucket, path}].
create or replace function public.voice_sweep_batch(
  p_limit    integer default 100,
  p_grace    interval default interval '6 hours',
  p_orphans  boolean default true
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select private.voice_sweep_pick(array['buddy-voice', 'note-voice'], p_limit, p_grace, p_orphans)
$$;

-- The function removed these objects through the Storage API: [{bucket, path}].
create or replace function public.voice_sweep_done(p_items jsonb)
returns void
language sql
security definer
set search_path = pg_catalog, private
as $$
  delete from private.buddy_voice_trash t
   using jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) e
   where t.bucket = e ->> 'bucket' and t.path = e ->> 'path'
$$;

-- The previous version of the function (and a deploy that lands before it): the `buddy-voice` rows only, as text[], so it is never handed a
-- path it cannot remove (it would report it removed and the queue would forget an object that is still there).
create or replace function public.buddy_voice_sweep_batch(
  p_limit    integer default 100,
  p_grace    interval default interval '6 hours',
  p_orphans  boolean default true
)
returns text[]
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select coalesce(array_agg(e.item ->> 'path' order by e.n), '{}')
    from jsonb_array_elements(private.voice_sweep_pick(array['buddy-voice'], p_limit, p_grace, p_orphans)) with ordinality e(item, n)
$$;

create or replace function public.buddy_voice_sweep_done(p_paths text[])
returns void
language sql
security definer
set search_path = pg_catalog, private
as $$
  delete from private.buddy_voice_trash where bucket = 'buddy-voice' and path = any (coalesce(p_paths, '{}'))
$$;

-- -------------------------------------------------------------------------- grants

revoke all on function private.note_voice_path(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.note_voice_parts(text) from public, anon, authenticated;
revoke all on function private.note_voice_gone() from public, anon, authenticated;
revoke all on function private.note_voice_attached(text) from public, anon, authenticated;
revoke all on function private.voice_sweep_pick(text[], integer, interval, boolean) from public, anon, authenticated;
revoke all on function private.room_messages_check() from public, anon, authenticated;
revoke all on function private.note_quote(uuid, uuid) from public, anon, authenticated;
revoke all on function private.note_json(uuid, public.room_messages) from public, anon, authenticated;

revoke all on function public.post_note_voice(uuid, uuid, uuid, text, text, integer, smallint[], uuid) from public, anon;
grant execute on function public.post_note_voice(uuid, uuid, uuid, text, text, integer, smallint[], uuid) to authenticated;
revoke all on function public.voice_sweep_batch(integer, interval, boolean) from public, anon, authenticated;
revoke all on function public.voice_sweep_done(jsonb) from public, anon, authenticated;
grant execute on function public.voice_sweep_batch(integer, interval, boolean) to service_role;
grant execute on function public.voice_sweep_done(jsonb) to service_role;
-- The replaced ones keep the grants they had (create or replace keeps them); said again so nothing depends on it.
revoke all on function public.buddy_voice_sweep_batch(integer, interval, boolean) from public, anon, authenticated;
revoke all on function public.buddy_voice_sweep_done(text[]) from public, anon, authenticated;
grant execute on function public.buddy_voice_sweep_batch(integer, interval, boolean) to service_role;
grant execute on function public.buddy_voice_sweep_done(text[]) to service_role;
