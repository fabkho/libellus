-- Buddy reads: voice messages (docs/parity.md, "Buddy read, a thread").
--
-- A member records up to two minutes in a room's thread (the room's or a Section's), sends it, and the other
-- members of the read play it in the bubble. A voice message is a message like any other of the thread: one
-- row in public.buddy_messages (kind 'voice'), answers (reply_to), a Spoiler mark in a Section, the six
-- reactions, a tombstone when it is deleted, a report, the same 30 a minute and 600 a day post limits, the same
-- lock order, the same block rule, the same read cursors. What is new is only where the sound lives.
--
-- What this migration adds:
--   columns   public.buddy_messages.voice_mime ('audio/mp4' | 'audio/webm' | 'audio/ogg'), voice_duration_ms
--             (1 - 120000: a MediaRecorder file often says Infinity itself, so the phone reads the length from
--             here) and voice_peaks (up to 48 values 0 - 100, the waveform the bubble draws). Three nullable
--             columns without a default: no table rewrite.
--   checks    buddy_messages_kind gains 'voice', buddy_messages_shape says which columns a voice message
--             carries and that a tombstone keeps none. The two old checks are dropped and the two new ones added
--             in this one transaction, so the table is locked ACCESS EXCLUSIVE from the ADD COLUMN until the
--             commit, and the new checks scan it once under that lock (a plain ADD CONSTRAINT: NOT VALID with a
--             VALIDATE after it would gain nothing here, the drop and the add already hold the lock until the
--             commit). That is a moment on a table that has held buddy messages since 1.34 and is small, and
--             `lock_timeout` of 5 s makes the migration fail and roll back, rather than queue every reader and
--             writer of the table behind it, should something hold the table.
--   bucket    `buddy-voice`, PRIVATE (no public URL, ever), 3 MB an object, audio/mp4 (Safari, Chrome 126+),
--             audio/webm (older Chrome, Android), audio/ogg (Firefox). The object of a message is
--             `<read id>/<author id>/<client id>.<m4a|webm|ogg>`: the name is worked out from the row
--             (private.buddy_voice_path), never stored and never sent over Realtime.
--   policies  on storage.objects: a member of the read, and nobody else, reads an object whose message is live
--             and whose author is not blocked with her either way (her own always); she writes only under her
--             own folder of a read she has joined that is not archived, at most 20 objects an hour. No update
--             and no delete policy: no member deletes an object, the database's sweep does.
--   helpers   private.buddy_voice_ext, buddy_voice_path, buddy_voice_readable, buddy_voice_writable,
--             buddy_voice_attached, buddy_voice_kick, the trash queue private.buddy_voice_trash (a path, when it
--             was queued, how often the sweep tried it) and the settings private.buddy_voice_settings (the
--             function's address, the debounce).
--   RPCs      send_buddy_voice (the sending), buddy_voice_sweep_batch / buddy_voice_sweep_done (for the Edge
--             Function `buddy-voice-sweep`, service role only).
--   changes   private.buddy_message_json (the voice object, never for a tombstone), delete_buddy_message (a
--             tombstone keeps no audio), report_buddy_message (the report carries the kind; a voice message's
--             excerpt says so), private.buddy_message_new (the Realtime payload: kind, length, waveform and type,
--             no audio location).
--   cron      pg_cron `sweep-buddy-voice` (hourly: the queue and the uploads nobody sent) and
--             `sweep-buddy-voice-queue` (every ten minutes: only when something waits in the queue).
--
-- Who may hear what. An object is read through a short-lived signed URL the app asks for when a member plays
-- it (`createSignedUrl`, 5 minutes): Storage checks the select policy below when it signs. A non-member, a
-- member who left, a member blocked with the author and a signed-out caller get nothing. The message row
-- (private.buddy_message_json) says kind 'voice', the length, the waveform, the type and the object's name
-- to a member who may read it; the Realtime payload (`message.new`) has no name at all, the app works it
-- out from the ids in it. Neither is of use without the bucket's policy. The veil of a Section is the app's
-- (as for text): a veiled Section is never opened, so no signed URL is asked for until she opens it, and
-- the app asks for a URL only when she presses play.
--
-- No audio outlives its message. An object is queued for removal (private.buddy_voice_trash, by trigger)
-- when its message row is deleted (a member leaving with "also delete my messages", her account deleted, a
-- read deleted: the foreign keys cascade and the trigger fires for every row) or becomes a tombstone (her
-- own delete, the host's). The database cannot remove a file itself (Storage's protect_delete refuses a
-- direct delete from SQL and a deleted row would leave the bytes in the object store), so the Edge Function
-- `buddy-voice-sweep` removes the queued objects through the Storage API, and, on its hourly run, objects no
-- message points at that are older than 6 hours (an upload whose message never came: the app refuses to send a
-- recording that waited longer than 4 hours in its queue, so a sent one is never swept first). The trigger
-- nudges the function once per transaction (pg_net, after commit) and at most once a minute (the debounce
-- in private.buddy_voice_settings: a member who sends and deletes ten times a minute makes one request); what a
-- debounced nudge left waits for the ten-minute job. The function is off until the owner gives it an address
-- (private.buddy_voice_settings.function_url, docs/OPERATIONS.md, "Voice messages"); nothing is sent before and
-- what is queued meanwhile waits in the table.
--
-- The sweep cannot be starved by one object it cannot remove: every time a path is handed to the function
-- its `attempts` count goes up and it waits longer before it is handed out again (5 minutes times its attempts),
-- the paths tried least go first, and after 20 attempts it is left in the queue for the owner to look at
-- (docs/OPERATIONS.md). An object nobody sent is queued by the hourly run when it finds it, so it is
-- counted the same way. The hourly run reads only the objects of this bucket and at most as many a run as the
-- function removes in one go (100 an ask, 10 asks a run).
--
-- What it leaves out: photos, GIFs and stickers (a voice message has no caption); a voice message in a
-- 1:1 chat (there is none here); transcoding (the file is kept as the phone recorded it).
--
-- Refusals of send_buddy_voice, as stable messages (the client maps by message): not_signed_in 42501;
-- not_found PT404 (no such read, not a joined member); PT409 buddy_read_archived, message_client_id_reused;
-- PT429 message_rate_limited (the 30 a minute and 600 a day of every message), rate_limited (10 voice
-- messages a minute, 100 a day); 22023 message_client_id_required, buddy_section_invalid,
-- message_spoiler_unavailable, message_reply_unavailable, message_voice_invalid (type, length or
-- waveform, a waveform with a null in it), message_voice_missing (no object at its name),
-- message_voice_too_large. The type the object was stored with is compared without its parameters
-- ("audio/webm;codecs=opus" is "audio/webm"): a browser's recorder names its codec and Storage keeps what it
-- is sent.
--
-- Safe on a live database: additive columns without a default, a bucket row, policies, new functions and a
-- queue table of its own; no data is rewritten and no table is locked beyond buddy_messages (above).

-- -------------------------------------------------------------------------- columns

-- Everything below is one transaction; a lock it cannot get in 5 s fails the migration (and rolls it back) instead of waiting.
set local lock_timeout = '5s';

alter table public.buddy_messages
  add column voice_mime        text,
  add column voice_duration_ms integer,
  add column voice_peaks       smallint[];

comment on column public.buddy_messages.voice_mime is
  'kind voice: the type it was recorded in (audio/mp4, audio/webm or audio/ogg); the object in buddy-voice is named after the ids and its extension (private.buddy_voice_path). Null otherwise and on a tombstone.';
comment on column public.buddy_messages.voice_duration_ms is
  'kind voice: how long it plays, 1 - 120000 ms. Null otherwise and on a tombstone.';
comment on column public.buddy_messages.voice_peaks is
  'kind voice: the waveform the bubble draws, up to 48 values 0 - 100. Null otherwise, when the phone sent none and on a tombstone.';

-- -------------------------------------------------------------------------- checks

alter table public.buddy_messages drop constraint buddy_messages_kind;
alter table public.buddy_messages drop constraint buddy_messages_shape;

alter table public.buddy_messages
  add constraint buddy_messages_kind check (kind in ('text', 'gif', 'voice'));

-- A tombstone keeps nothing it said; a live text has something visible; a GIF is KLIPY's, with a size; a voice
-- message has a type, a length and (maybe) a waveform and no words.
alter table public.buddy_messages
  add constraint buddy_messages_shape check (coalesce(
    case
      when deleted_at is not null
        then body = '' and media_url is null and media_width is null and media_height is null
             and voice_mime is null and voice_duration_ms is null and voice_peaks is null
      when kind = 'text'
        then char_length(body) >= 1 and body ~ '[^[:space:][:cntrl:]\u00a0\u200b]'
             and media_url is null and media_width is null and media_height is null
             and voice_mime is null and voice_duration_ms is null and voice_peaks is null
      when kind = 'gif'
        then char_length(media_url) <= 500
             and media_url ~ '^https://static[0-9]*\.klipy\.com/[A-Za-z0-9._~%/+=?&-]+$'
             and media_width between 1 and 10000 and media_height between 1 and 10000
             and voice_mime is null and voice_duration_ms is null and voice_peaks is null
      when kind = 'voice'
        then body = '' and media_url is null and media_width is null and media_height is null
             and voice_mime in ('audio/mp4', 'audio/webm', 'audio/ogg')
             and voice_duration_ms between 1 and 120000
             and (voice_peaks is null or (cardinality(voice_peaks) between 1 and 48
                                          and 0 <= all (voice_peaks) and 100 >= all (voice_peaks)))
      else false
    end, false));

comment on table public.buddy_messages is
  'Buddy reads (20261113030000, 20261114020000): the messages of a read. section_id null = the room thread, else a Section''s '
  'thread (of the same read, checked by post_buddy_message and send_buddy_voice). kind text, gif (a KLIPY address) or voice (voice_*: '
  'the sound is an object in the private bucket buddy-voice). deleted_at set = a tombstone: no body, no media, no audio. '
  'created_at is clock order per read, never before an earlier message. Read and written only through the buddy read functions.';

-- -------------------------------------------------------------------------- the bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('buddy-voice', 'buddy-voice', false, 3 * 1024 * 1024, array['audio/mp4', 'audio/webm', 'audio/ogg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -------------------------------------------------------------------------- names

-- The extension an object has for its type; null for anything else.
create or replace function private.buddy_voice_ext(p_mime text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case p_mime when 'audio/mp4' then 'm4a' when 'audio/webm' then 'webm' when 'audio/ogg' then 'ogg' end
$$;

-- The object of a voice message: `<read>/<author>/<client id>.<ext>`. One name per (author, client id), which
-- is unique, so a retried send cannot make a second object and the name needs no column.
create or replace function private.buddy_voice_path(p_read uuid, p_author uuid, p_client uuid, p_mime text)
returns text
language sql
immutable
set search_path = pg_catalog, private
as $$
  select p_read::text || '/' || p_author::text || '/' || p_client::text || '.' || private.buddy_voice_ext(p_mime)
$$;

-- -------------------------------------------------------------------------- the trash queue and its settings

-- Objects whose message is gone: removed by the Edge Function, then forgotten here. Only the service role reads it.
create table private.buddy_voice_trash (
  path            text primary key,
  queued_at       timestamptz not null default now(),
  -- How often the sweep handed the path to the function, and when last: a path the Storage API keeps refusing waits longer
  -- each time and, after 20 tries, is left here for the owner (buddy_voice_sweep_batch).
  attempts        integer not null default 0,
  last_attempt_at timestamptz
);

comment on table private.buddy_voice_trash is
  'buddy-voice objects whose message is gone (deleted, a tombstone, its author''s account deleted) or that no message ever pointed at: removed from storage by the Edge Function buddy-voice-sweep, then forgotten here. attempts: how often the function was handed the path (20 is the last).';

alter table private.buddy_voice_trash enable row level security;
revoke all on private.buddy_voice_trash from public, anon, authenticated;

-- Where the sweeping function is; null = off (nothing is sent, the queue waits). Its token is the Vault secret
-- buddy_voice_sweep_token.
create table private.buddy_voice_settings (
  id            boolean primary key default true check (id),
  function_url  text check (function_url ~ '^https?://[^[:space:]]+$'),
  -- The kick of a deletion does not ask the function again sooner than this after the last kick (the hourly and ten-minute jobs are
  -- not held back): a member who sends and deletes ten times a minute makes one request, not ten.
  min_interval  interval not null default interval '1 minute' check (min_interval >= interval '0'),
  last_kick_at  timestamptz
);

comment on table private.buddy_voice_settings is
  'Where the buddy-voice-sweep edge function is (null = off), and when it was last kicked (the debounce). One row. Its token is the Vault secret buddy_voice_sweep_token.';

insert into private.buddy_voice_settings default values;
alter table private.buddy_voice_settings enable row level security;
revoke all on private.buddy_voice_settings from public, anon, authenticated;

-- Asks the function to sweep now (pg_net, after the calling transaction commits), at most once in `min_interval` (p_force asks
-- anyway: the jobs). p_full also lets the function look for objects nobody sent (the hourly job): a kick for a deletion only
-- empties the queue, which is cheap. Answers 'off' (no address: the local stack, CI), 'unavailable' (no pg_net or no Vault
-- secret), 'debounced' (asked a moment ago: the ten-minute job will see what is left) or 'sent'. Never raises.
create or replace function private.buddy_voice_kick(p_force boolean default false, p_full boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url     text;
  v_token   text;
  v_request bigint;
begin
  select function_url into v_url from private.buddy_voice_settings where id;
  if v_url is null then return 'off'; end if;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return 'unavailable';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_token using 'buddy_voice_sweep_token';
  if nullif(btrim(v_token), '') is null then return 'unavailable'; end if;
  -- The slot: one statement, so two transactions that kick together cannot both take it (the second waits for the first's commit
  -- and then finds the interval running).
  update private.buddy_voice_settings
     set last_kick_at = clock_timestamp()
   where id and (p_force or last_kick_at is null or last_kick_at < clock_timestamp() - min_interval);
  if not found then return 'debounced'; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 30000)'
    into v_request
    using v_url, jsonb_build_object('full', coalesce(p_full, false)),
          jsonb_build_object('Authorization', 'Bearer ' || btrim(v_token), 'Content-Type', 'application/json');
  return 'sent';
exception when others then
  raise warning 'buddy-voice sweep not requested: %', sqlerrm;
  return 'unavailable';
end;
$$;

-- A voice message's row went (deleted, or a tombstone now): its object is queued, and the function is asked once
-- per transaction, however many rows that were. Fires for the rows a cascade deletes too (an account, a read).
create or replace function private.buddy_voice_gone()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  insert into private.buddy_voice_trash (path)
  values (private.buddy_voice_path(old.buddy_read_id, old.author_id, old.client_id, old.voice_mime))
  on conflict do nothing;
  if coalesce(current_setting('buddy_voice.kicked', true), '') <> 'on' then
    perform set_config('buddy_voice.kicked', 'on', true);
    perform private.buddy_voice_kick();
  end if;
  return null;
exception when others then
  -- Never costs the delete or the account its success; the hourly job finds the object by the sweep's second rule (the uploads nobody sent).
  raise warning 'buddy-voice: object of message % not queued: %', old.id, sqlerrm;
  return null;
end;
$$;

create trigger buddy_messages_voice_deleted
  after delete on public.buddy_messages
  for each row when (old.voice_mime is not null)
  execute function private.buddy_voice_gone();

create trigger buddy_messages_voice_tombstone
  after update of voice_mime on public.buddy_messages
  for each row when (old.voice_mime is not null and new.voice_mime is null)
  execute function private.buddy_voice_gone();

-- -------------------------------------------------------------------------- the bucket's policies

-- A name in the bucket: `<read>/<author>/<client id>.<ext>`, lower-case uuids. The parts, or null.
create or replace function private.buddy_voice_parts(p_name text)
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select regexp_match(p_name,
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(m4a|webm|ogg)$')
$$;

-- The select policy: the caller is a joined member of the read the name says, the author is not blocked with her
-- either way (her own always), and a live voice message of that author, client id and type points at the name.
-- A tombstone points at nothing, so its object cannot be signed even before the sweep has removed it.
create or replace function private.buddy_voice_readable(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_parts  text[] := private.buddy_voice_parts(p_name);
begin
  if v_caller is null or v_parts is null then
    return false;
  end if;
  if not exists (select 1 from public.buddy_read_members m
                  where m.buddy_read_id = v_parts[1]::uuid and m.member_id = v_caller and m.joined_at is not null) then
    return false;
  end if;
  if private.buddy_hidden(v_caller, v_parts[2]::uuid) then
    return false;
  end if;
  return exists (select 1 from public.buddy_messages x
                  where x.author_id = v_parts[2]::uuid and x.client_id = v_parts[3]::uuid
                    and x.buddy_read_id = v_parts[1]::uuid
                    and x.deleted_at is null and x.voice_mime is not null
                    and private.buddy_voice_ext(x.voice_mime) = v_parts[4]);
end;
$$;

-- The insert policy: her own folder of a read she has joined that is not archived, at most 20 objects an hour (the
-- post limits count messages, and an upload comes before its message; 20 x 3 MB a member an hour is the most that can wait, unsent, for the sweep).
create or replace function private.buddy_voice_writable(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_parts  text[] := private.buddy_voice_parts(p_name);
begin
  if v_caller is null or v_parts is null or v_parts[2] <> v_caller::text then
    return false;
  end if;
  if not exists (select 1 from public.buddy_read_members m
                   join public.buddy_reads r on r.id = m.buddy_read_id
                  where m.buddy_read_id = v_parts[1]::uuid and m.member_id = v_caller and m.joined_at is not null
                    and r.status <> 'archived') then
    return false;
  end if;
  return (select count(*) from storage.objects o
           where o.bucket_id = 'buddy-voice' and o.owner_id = v_caller::text
             and o.created_at > now() - interval '1 hour') < 20;
end;
$$;

-- The policies run as the member: Postgres checks EXECUTE on a function they hold, not the schema, so private stays closed.
revoke all on function private.buddy_voice_readable(text) from public, anon, authenticated;
revoke all on function private.buddy_voice_writable(text) from public, anon, authenticated;
grant execute on function private.buddy_voice_readable(text) to authenticated;
grant execute on function private.buddy_voice_writable(text) to authenticated;

create policy buddy_voice_select_members on storage.objects
  for select to authenticated
  using (bucket_id = 'buddy-voice' and private.buddy_voice_readable(name));

create policy buddy_voice_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'buddy-voice' and private.buddy_voice_writable(name));

-- -------------------------------------------------------------------------- a message as the API answers it

-- As 20261113030000_buddy_read_messages.sql left it, plus `voice`: {path, mime, duration_ms, peaks} for a live voice
-- message and no `voice` key otherwise, for a tombstone too (a deleted voice message does not say it was one, as a GIF
-- does not): a text or GIF message reads exactly as before.
create or replace function private.buddy_message_json(p_caller uuid, p_message public.buddy_messages)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'id', p_message.id,
    'section_id', p_message.section_id,
    'author', jsonb_build_object('id', p_message.author_id, 'name', private.member_name(p_message.author_id)),
    'client_id', p_message.client_id,
    'kind', case when p_message.deleted_at is null then p_message.kind else 'text' end,
    'body', case when p_message.deleted_at is null then p_message.body end,
    'media_url', case when p_message.deleted_at is null then p_message.media_url end,
    'media_width', case when p_message.deleted_at is null then p_message.media_width end,
    'media_height', case when p_message.deleted_at is null then p_message.media_height end,
    'reply_to', (select r.id from public.buddy_messages r
                  where r.id = p_message.reply_to and not private.buddy_hidden(p_caller, r.author_id)),
    'spoiler', p_message.spoiler,
    'created_at', p_message.created_at,
    'deleted_at', p_message.deleted_at,
    'reactions', case when p_message.deleted_at is null
                      then private.buddy_reactions_json(p_caller, p_message.id) else '[]'::jsonb end
  ) || case when p_message.deleted_at is null and p_message.voice_mime is not null
            then jsonb_build_object('voice', jsonb_build_object(
                   'path', private.buddy_voice_path(p_message.buddy_read_id, p_message.author_id, p_message.client_id, p_message.voice_mime),
                   'mime', p_message.voice_mime,
                   'duration_ms', p_message.voice_duration_ms,
                   'peaks', to_jsonb(p_message.voice_peaks)))
            else '{}'::jsonb end
$$;

-- -------------------------------------------------------------------------- send_buddy_voice

-- Post a voice message the caller has uploaded: p_mime its type, p_duration_ms how long it plays (1 - 120000),
-- p_peaks the waveform (up to 48 values 0 - 100, null for none). The object must be there already, at
-- private.buddy_voice_path(p_read, her, p_client_id, p_mime), of that type and at most 3 MB. In the room
-- (p_section null) or a Section's thread; p_reply_to answers a live message of the same thread; p_spoiler only in a
-- Section. Idempotent on (her, p_client_id) like post_buddy_message: the same call again answers the message it
-- made; the same client id for another read, thread or kind is message_client_id_reused. Answers the message as
-- buddy_read_messages does. The rules are post_buddy_message's (same locks, same order, same limits over all her
-- messages), and a voice message is counted against its own 10 a minute and 100 a day as well.
create or replace function public.send_buddy_voice(
  p_read        uuid,
  p_section     uuid,
  p_client_id   uuid,
  p_mime        text,
  p_duration_ms integer,
  p_peaks       integer[] default null,
  p_reply_to    uuid default null,
  p_spoiler     boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_row    public.buddy_messages;
  v_status text;
  v_path   text;
  v_object jsonb;
  v_size   bigint;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'message_client_id_required' using errcode = '22023';
  end if;

  perform private.buddy_lock_member(v_caller);

  -- A retry: the message it made, before the gate (a retry after she left still gets its answer).
  select * into v_row from public.buddy_messages where author_id = v_caller and client_id = p_client_id;
  if found then
    if v_row.buddy_read_id is distinct from p_read or v_row.section_id is distinct from p_section
       or v_row.kind is distinct from 'voice' then
      raise exception 'message_client_id_reused' using errcode = 'PT409';
    end if;
    return private.buddy_message_json(v_caller, v_row);
  end if;

  perform private.buddy_gate(p_read, v_caller);
  perform private.buddy_lock_read(p_read);
  perform private.buddy_gate(p_read, v_caller);

  select status into v_status from public.buddy_reads where id = p_read;
  if v_status = 'archived' then
    raise exception 'buddy_read_archived' using errcode = 'PT409';
  end if;
  if p_section is not null
     and not exists (select 1 from public.buddy_read_sections where id = p_section and buddy_read_id = p_read) then
    raise exception 'buddy_section_invalid' using errcode = '22023';
  end if;
  if coalesce(p_spoiler, false) and p_section is null then
    raise exception 'message_spoiler_unavailable' using errcode = '22023';
  end if;

  if private.buddy_voice_ext(p_mime) is null
     or p_duration_ms is null or p_duration_ms not between 1 and 120000
     or (p_peaks is not null and (cardinality(p_peaks) not between 1 and 48
                                  or array_position(p_peaks, null) is not null
                                  or 0 > any (p_peaks) or 100 < any (p_peaks))) then
    raise exception 'message_voice_invalid' using errcode = '22023';
  end if;

  -- The object: there, of the type said, not empty, not over the bucket's 3 MB.
  v_path := private.buddy_voice_path(p_read, v_caller, p_client_id, p_mime);
  select o.metadata into v_object from storage.objects o where o.bucket_id = 'buddy-voice' and o.name = v_path;
  if not found then
    raise exception 'message_voice_missing' using errcode = '22023';
  end if;
  -- The type Storage kept, without its parameters: a browser's recorder says "audio/webm;codecs=opus" and Storage keeps what it is sent.
  if lower(btrim(split_part(coalesce(v_object ->> 'mimetype', ''), ';', 1))) is distinct from p_mime then
    raise exception 'message_voice_invalid' using errcode = '22023';
  end if;
  v_size := coalesce(nullif(v_object ->> 'size', '')::bigint, 0);
  if v_size > 3 * 1024 * 1024 then
    raise exception 'message_voice_too_large' using errcode = '22023';
  end if;
  if v_size < 1 then
    raise exception 'message_voice_invalid' using errcode = '22023';
  end if;

  if p_reply_to is not null and not exists (
    select 1 from public.buddy_messages r
     where r.id = p_reply_to and r.buddy_read_id = p_read and r.section_id is not distinct from p_section
       and r.deleted_at is null and not private.buddy_hidden(v_caller, r.author_id)
  ) then
    raise exception 'message_reply_unavailable' using errcode = '22023';
  end if;

  -- The limits of every message: 30 a minute, 600 a day, over all her reads, under her member lock.
  if (select count(*) from public.buddy_messages
       where author_id = v_caller and created_at > clock_timestamp() - interval '1 minute') >= 30
     or (select count(*) from public.buddy_messages
          where author_id = v_caller and created_at > clock_timestamp() - interval '1 day') >= 600 then
    raise exception 'message_rate_limited' using errcode = 'PT429';
  end if;
  -- And a voice message's own, which keeps the bucket small: 10 a minute, 100 a day.
  perform private.buddy_rate_window(v_caller, 'voice', 10, interval '1 minute');
  perform private.buddy_rate_window(v_caller, 'voice_day', 100, interval '1 day');

  insert into public.buddy_messages (buddy_read_id, section_id, author_id, client_id, kind, body,
                                     voice_mime, voice_duration_ms, voice_peaks, reply_to, spoiler, created_at)
  values (p_read, p_section, v_caller, p_client_id, 'voice', '',
          p_mime, p_duration_ms, p_peaks::smallint[], p_reply_to, coalesce(p_spoiler, false),
          greatest(clock_timestamp(),
                   (select max(m.created_at) + interval '1 microsecond'
                      from public.buddy_messages m where m.buddy_read_id = p_read)))
  returning * into v_row;
  return private.buddy_message_json(v_caller, v_row);
end;
$$;

-- -------------------------------------------------------------------------- delete: a tombstone keeps no audio

-- As 20261113030000_buddy_read_messages.sql left it, and the tombstone clears the voice columns too: the trigger
-- queues the object. Delete a message: the author hers, the host any (also one by a member she blocked, or who
-- blocked her: she moderates her room). It stays as a tombstone (its place in the thread, the answers to it),
-- without its words, its GIF, its sound or its reactions. Also in an archived read. Again: nothing changes.
create or replace function public.delete_buddy_message(p_message uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_msg    public.buddy_messages;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  v_msg := private.buddy_message_for(p_message, v_caller, p_as_host => true);
  if v_msg.author_id <> v_caller and (private.buddy_gate(v_msg.buddy_read_id, v_caller)).role <> 'host' then
    raise exception 'message_not_yours' using errcode = 'PT403';
  end if;
  if v_msg.deleted_at is not null then
    return;
  end if;
  delete from public.buddy_reactions where message_id = p_message;
  update public.buddy_messages
     set body = '', media_url = null, media_width = null, media_height = null,
         voice_mime = null, voice_duration_ms = null, voice_peaks = null,
         deleted_at = clock_timestamp(), deleted_by = v_caller
   where id = p_message;
end;
$$;

-- -------------------------------------------------------------------------- reports show the kind

-- As 20261113030000_buddy_read_messages.sql left it, and the context says the message's kind; a voice message has no
-- words, so its excerpt says what it is and how long it plays.
create or replace function public.report_buddy_message(p_message uuid, p_reason text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_note   text := nullif(btrim(coalesce(p_note, ''), E' \t\n\r'), '');
  v_msg    public.buddy_messages;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('harassment', 'spam', 'inappropriate', 'other') then
    raise exception 'report_reason_invalid' using errcode = '22023';
  end if;
  if char_length(v_note) > 1000 then
    raise exception 'report_note_too_long' using errcode = '22023';
  end if;
  v_msg := private.buddy_message_for(p_message, v_caller);
  if v_msg.author_id = v_caller then
    raise exception 'report_self' using errcode = '22023';
  end if;
  if v_msg.deleted_at is not null then
    raise exception 'message_unavailable' using errcode = 'PT409';
  end if;
  -- Reported before: her first report stands. Under the read's lock, so two at once make one row.
  if exists (select 1 from public.feedback f
              where f.member_id = v_caller and f.kind = 'report' and f.context ->> 'message' = v_msg.id::text) then
    return;
  end if;

  insert into public.feedback (member_id, kind, body, context)
  values (v_caller, 'report',
          'Buddy read report: ' || p_reason || coalesce(E'\n\n' || v_note, ''),
          jsonb_build_object(
            'buddy_read', v_msg.buddy_read_id,
            'section', v_msg.section_id,
            'message', v_msg.id,
            'author', v_msg.author_id,
            'kind', v_msg.kind,
            'excerpt', case when v_msg.kind = 'voice'
                            then 'Voice message, ' || round(v_msg.voice_duration_ms / 1000.0)::integer || ' s'
                            else left(concat_ws(' ', nullif(v_msg.body, ''), v_msg.media_url), 300) end));
end;
$$;

-- -------------------------------------------------------------------------- Realtime: what a member's other devices hear

-- As 20261113040000_buddy_read_realtime.sql left it, plus `voice` {mime, duration_ms, peaks} for a voice message only: no
-- object name and no URL. The app works the object's name out from the ids in the payload; it is only of use to a
-- member of the read (the bucket's policy), and the payload goes to those only (private.buddy_recipients).
create or replace function private.buddy_message_new()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  perform private.buddy_send(
    'message.new',
    jsonb_build_object(
      'id', new.id, 'buddy_read_id', new.buddy_read_id, 'section_id', new.section_id,
      'author_id', new.author_id, 'client_id', new.client_id, 'kind', new.kind, 'body', new.body,
      'media_url', new.media_url, 'media_width', new.media_width, 'media_height', new.media_height,
      'reply_to', new.reply_to, 'spoiler', new.spoiler, 'created_at', new.created_at)
    || case when new.voice_mime is not null
            then jsonb_build_object('voice', jsonb_build_object('mime', new.voice_mime, 'duration_ms', new.voice_duration_ms,
                                                                'peaks', to_jsonb(new.voice_peaks)))
            else '{}'::jsonb end,
    array(select private.buddy_recipients(new.buddy_read_id, new.author_id)));
  return null;
end;
$$;

-- -------------------------------------------------------------------------- the sweep (service role only)

-- Whether a live voice message points at this object's name.
create or replace function private.buddy_voice_attached(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_parts text[] := private.buddy_voice_parts(p_name);
begin
  if v_parts is null then
    return false;
  end if;
  return exists (select 1 from public.buddy_messages m
                  where m.author_id = v_parts[2]::uuid and m.client_id = v_parts[3]::uuid
                    and m.buddy_read_id = v_parts[1]::uuid
                    and m.voice_mime is not null and private.buddy_voice_ext(m.voice_mime) = v_parts[4]);
end;
$$;

-- For the Edge Function buddy-voice-sweep: the objects to remove now, at most p_limit. The queue (paths of deleted messages), the
-- ones tried least first; a path waits 5 minutes times the tries it has had before it is handed out again and is left alone after
-- 20 (so one object Storage will not remove cannot starve the rest, nor be asked for again in the same run). With p_orphans (the
-- hourly run) it first queues, at most p_limit, the objects of the bucket no message points at that are older than p_grace (6 hours:
-- a younger one may be an upload whose message is on its way: the app sends a recording that waited at most 4 hours, VOICE_QUEUE_MAX_AGE_MS).
-- Never an object a live message points at; a queued path whose object is gone or whose message came back is forgotten.
create or replace function public.buddy_voice_sweep_batch(
  p_limit    integer default 100,
  p_grace    interval default interval '6 hours',
  p_orphans  boolean default true
)
returns text[]
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_paths text[];
begin
  if coalesce(p_orphans, false) then
    insert into private.buddy_voice_trash (path)
    select o.name
      from storage.objects o
     where o.bucket_id = 'buddy-voice'
       and o.created_at < now() - p_grace
       and not exists (select 1 from private.buddy_voice_trash t where t.path = o.name)
       and not private.buddy_voice_attached(o.name)
     limit v_limit
    on conflict do nothing;
  end if;

  delete from private.buddy_voice_trash t
   where private.buddy_voice_attached(t.path)
      or not exists (select 1 from storage.objects o where o.bucket_id = 'buddy-voice' and o.name = t.path);

  with picked as (
    select t.path
      from private.buddy_voice_trash t
     where t.attempts < 20
       and (t.last_attempt_at is null or t.last_attempt_at < now() - t.attempts * interval '5 minutes')
     order by t.attempts, t.queued_at
     limit v_limit
       for update skip locked
  ), marked as (
    update private.buddy_voice_trash t
       set attempts = t.attempts + 1, last_attempt_at = now()
      from picked
     where t.path = picked.path
    returning t.path, t.queued_at
  )
  select coalesce(array_agg(m.path order by m.queued_at, m.path), '{}') into v_paths from marked m;
  return v_paths;
end;
$$;

-- The function removed these objects through the Storage API.
create or replace function public.buddy_voice_sweep_done(p_paths text[])
returns void
language sql
security definer
set search_path = pg_catalog, private
as $$
  delete from private.buddy_voice_trash where path = any (coalesce(p_paths, '{}'))
$$;

-- The hourly job: asks the function whatever the debounce says, and to look for uploads nobody sent as well.
create or replace function private.buddy_voice_sweep_tick()
returns text
language sql
security definer
set search_path = pg_catalog, private
as $$
  select private.buddy_voice_kick(true, true)
$$;

-- Every ten minutes: asks only when something waits that the function may be handed (a kick the debounce held back, a run that
-- failed), so a quiet bucket costs one count of a small table.
create or replace function private.buddy_voice_queue_tick()
returns text
language sql
security definer
set search_path = pg_catalog, private
as $$
  select case when exists (select 1 from private.buddy_voice_trash t
                            where t.attempts < 20
                              and (t.last_attempt_at is null or t.last_attempt_at < now() - t.attempts * interval '5 minutes'))
              then private.buddy_voice_kick(true, false)
              else 'idle' end
$$;

-- -------------------------------------------------------------------------- grants

revoke all on function private.buddy_voice_ext(text) from public, anon, authenticated;
revoke all on function private.buddy_voice_path(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.buddy_voice_parts(text) from public, anon, authenticated;
revoke all on function private.buddy_voice_kick(boolean, boolean) from public, anon, authenticated;
revoke all on function private.buddy_voice_gone() from public, anon, authenticated;
revoke all on function private.buddy_voice_attached(text) from public, anon, authenticated;
revoke all on function private.buddy_voice_sweep_tick() from public, anon, authenticated;
revoke all on function private.buddy_voice_queue_tick() from public, anon, authenticated;
revoke all on function private.buddy_message_json(uuid, public.buddy_messages) from public, anon, authenticated;
revoke all on function private.buddy_message_new() from public, anon, authenticated;

revoke all on function public.send_buddy_voice(uuid, uuid, uuid, text, integer, integer[], uuid, boolean) from public, anon;
grant execute on function public.send_buddy_voice(uuid, uuid, uuid, text, integer, integer[], uuid, boolean) to authenticated;
revoke all on function public.buddy_voice_sweep_batch(integer, interval, boolean) from public, anon, authenticated;
revoke all on function public.buddy_voice_sweep_done(text[]) from public, anon, authenticated;
grant execute on function public.buddy_voice_sweep_batch(integer, interval, boolean) to service_role;
grant execute on function public.buddy_voice_sweep_done(text[]) to service_role;

-- -------------------------------------------------------------------------- pg_cron

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('sweep-buddy-voice', '37 * * * *', 'select private.buddy_voice_sweep_tick()');
      perform cron.schedule('sweep-buddy-voice-queue', '7,17,27,47,57 * * * *', 'select private.buddy_voice_queue_tick()');
    exception when others then
      raise warning 'sweep-buddy-voice could not be scheduled (%): objects of deleted voice messages are removed only when a deletion kicks the function', sqlerrm;
    end;
  else
    raise warning 'pg_cron is not here: enable it, then schedule sweep-buddy-voice (select cron.schedule(''sweep-buddy-voice'', ''37 * * * *'', ''select private.buddy_voice_sweep_tick()'')) and sweep-buddy-voice-queue (''7,17,27,47,57 * * * *'', ''select private.buddy_voice_queue_tick()'')';
  end if;
end;
$$;
