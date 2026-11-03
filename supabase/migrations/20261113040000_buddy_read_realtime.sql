-- Buddy reads, D4: live updates over a private topic per member (docs/plans/buddy-read-shared.md
-- part 4.4, and 4.5 items 46 to 51).
--
-- The database tells a member's open devices that something in her buddy reads changed, over Supabase
-- Realtime Broadcast: one private channel per member, topic `member:<her id>`. Only the database
-- sends (the triggers below, through realtime.send(..., private => true)); a member may join her own
-- topic and nothing else. This is the first Realtime Authorization policy of this repository.
--
-- Events, payloads (JSON) and who gets them:
--   message.new         {id, buddy_read_id, section_id, author_id, client_id, kind, body, media_url,
--                       media_width, media_height, reply_to, spoiler, created_at}: the new message row
--                       without deleted_*. The whole row, Section threads too: the veil is the app's
--                       (Q8, plan part 5.4). To every joined member not blocked either way with the
--                       author, and the author's own topic (her other devices).
--   message.deleted     {id, buddy_read_id, section_id}: a message became a tombstone. No body. Same
--                       recipients as its message.new.
--   message.reaction    {message_id, buddy_read_id, member_id, emoji}: member_id's reaction is now
--                       emoji, null when it was removed (a tombstone clears every reaction of its
--                       message, one event each). To every joined member blocked with neither the
--                       reacting member nor the author, and the reacting member's own topic.
--   buddy_read.changed  {buddy_read_id} and nothing else: read buddy_read() again. Sent when a member
--                       joins (link or accepted invitation), leaves, is removed or her account goes,
--                       a role changes (the host handover), a member's Section changes (her row's
--                       generated read_through, whatever wrote it: set_buddy_hand, or her reading
--                       progress through D2's triggers), the Sections change, or the read's status changes. For a member's
--                       change: to every joined member not blocked either way with her, and her own
--                       topic (also when she just left or was removed: her screen closes). For the
--                       Sections or the status: to every joined member. At most once per read and
--                       recipient in one statement (a leave with a host handover, a new division that
--                       moves every member's Section: one event, not one per row).
--   buddy.invitation    {buddy_read_id}: to the invitee only, when she is invited and when her
--                       invitation goes (declined, withdrawn): read my_buddy_reads() again.
--
-- realtime.send adds an `id` key (the broadcast's own new uuid) to a payload that has none, so
-- message.reaction, buddy_read.changed and buddy.invitation arrive with it; it says nothing about the
-- read. No payload carries a page, a percent, a fraction, read_through, hand_through, auto_through, an
-- entry id or a Section number: a member's Section reaches the others only through buddy_read(), as
-- D1 shows it (and hides it across a block).
--
-- Broadcast delivers while a device is connected; the tables stay the source of truth. After a
-- reconnect or a cold start the app reads what it missed through the RPCs (the layer's liveChannel).
-- A failed send never fails the write: realtime.send catches its own errors and raises a warning, and
-- every fan-out here is wrapped again the same way.
--
-- What this migration adds:
--   private.member_topic(member)               the topic; executable by authenticated (the policy
--                                              below runs as her), with no usage on schema private,
--                                              so nobody can call it by name.
--   policy buddy_member_topic_select           on realtime.messages: she may read broadcasts on her own
--                                              topic only. No insert policy: no member can send.
--   private.buddy_recipients, buddy_send,      who gets an event, the guarded fan-out, the once-per-
--   buddy_changed                              statement buddy_read.changed.
--   triggers                                   on buddy_messages, buddy_reactions, buddy_read_members,
--                                              buddy_reads (status) and buddy_read_sections (statement
--                                              level). Trigger functions in private, revoked from
--                                              public, anon and authenticated.
--
-- What it leaves out: the client (W2: the lazily loaded Realtime client, the layer's liveChannel);
-- the import job's feed, which stays postgres_changes on the supabase_realtime publication
-- (web/app/data/importJobFeed.ts; the publication is not touched); presence; events for a hard delete of
-- messages (a member leaving with "also delete my messages", an account deleted): the
-- buddy_read.changed of her leaving tells the others to read the read again. No change to a D1 or D3
-- function body.
--
-- Account deletion and a deleted read cascade over many rows: every trigger here does nothing when the
-- read, the message or the member is already gone, and never raises.
--
-- Costs (Free plan, figures from the plan's part 9.4, not re-checked): one Realtime message per
-- recipient. A post in a full read (12 members) is 12 messages (11 others and the author's own topic),
-- against 2 million a month; one connection per device with a buddy read open, against 200 at once.
--
-- For the owner, before the first release (O3): hosted Realtime has a project setting that lets
-- clients use public channels ("Allow public access" in Realtime's settings; the wording is from
-- memory, not checked). Turn it off, so private channels and this policy are the only way to listen;
-- then check the import job's live feed (postgres_changes) still works on a scratch project with that
-- setting off. docs/OPERATIONS.md, "Realtime", has the rest.
--
-- The schema snapshot does not cover policies on realtime.messages (supabase/schema-snapshot/README.md,
-- "Left out on purpose"): supabase/tests/buddy_realtime_test.sql is the only guard of the policy.

-- -------------------------------------------------------------------------- the topic

create or replace function private.member_topic(p_member uuid)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'member:' || p_member::text
$$;

-- Postgres checks EXECUTE on a function in a policy when the policy runs, as the member: the policy
-- below needs it. It does not check usage on the schema then (the policy holds the function itself,
-- not its name), so private stays closed: authenticated cannot call it by name.
revoke all on function private.member_topic(uuid) from public, anon, authenticated;
grant execute on function private.member_topic(uuid) to authenticated;

-- -------------------------------------------------------------------------- the authorization

-- Joining a private channel is a select on realtime.messages, with realtime.topic() set to the
-- channel's topic and her token's claims: she may join member:<her id> and nothing else.
create policy buddy_member_topic_select on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and (select realtime.topic()) = private.member_topic((select auth.uid()))
  );

-- No insert policy: no member can send on any private topic, her own included. Only the database
-- sends, through the triggers below.

-- -------------------------------------------------------------------------- helpers

-- Who hears of a change in a read: every joined member, less those blocked either way with p_actor,
-- and p_actor herself (her other devices; also when she just left), unless her account is gone.
-- p_actor null: every joined member, no block test (the Sections, the status).
create or replace function private.buddy_recipients(p_read uuid, p_actor uuid)
returns setof uuid
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select m.member_id
    from public.buddy_read_members m
   where m.buddy_read_id = p_read
     and m.joined_at is not null
     and (p_actor is null or not private.buddy_hidden(m.member_id, p_actor))
  union
  select p_actor
   where p_actor is not null
     and exists (select 1 from auth.users u where u.id = p_actor)
$$;

-- Sends one event to each member's topic. A failure is a warning, never an error: the write that
-- caused it goes through.
create or replace function private.buddy_send(p_event text, p_payload jsonb, p_members uuid[])
returns void
language plpgsql
set search_path = pg_catalog, public, private
as $$
declare
  v_member uuid;
begin
  begin
    foreach v_member in array coalesce(p_members, '{}') loop
      perform realtime.send(p_payload, p_event, private.member_topic(v_member), true);
    end loop;
  exception when others then
    raise warning 'buddy_send % failed: % (%)', p_event, sqlerrm, sqlstate;
  end;
end;
$$;

-- buddy_read.changed for p_read, to private.buddy_recipients(p_read, p_actor), at most once per read and
-- member in one statement: one RPC call that touches many rows (a new division moving every Section, a
-- leave with a host handover, an account deleted) sends one event to each, not one per row. The list
-- of what was sent lives in a transaction-local setting keyed by the statement's start; the client
-- reads the read again after the commit, so one event says all of it.
create or replace function private.buddy_changed(p_read uuid, p_actor uuid)
returns void
language plpgsql
set search_path = pg_catalog, public, private
as $$
declare
  v_stmt text := statement_timestamp()::text;
  v_sent text := current_setting('buddy.changed_sent', true);
  v_to   uuid[];
begin
  if p_read is null or not exists (select 1 from public.buddy_reads where id = p_read) then
    return;
  end if;
  if v_sent is null or split_part(v_sent, ';', 1) <> v_stmt then
    v_sent := v_stmt;
  end if;
  select coalesce(array_agg(r), '{}') into v_to
    from private.buddy_recipients(p_read, p_actor) r
   where position(';' || p_read || ':' || r in v_sent) = 0;
  if cardinality(v_to) = 0 then
    return;
  end if;
  select v_sent || string_agg(';' || p_read || ':' || r, '') into v_sent from unnest(v_to) r;
  perform set_config('buddy.changed_sent', v_sent, true);
  perform private.buddy_send('buddy_read.changed', jsonb_build_object('buddy_read_id', p_read), v_to);
end;
$$;

-- -------------------------------------------------------------------------- messages

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
      'reply_to', new.reply_to, 'spoiler', new.spoiler, 'created_at', new.created_at),
    array(select private.buddy_recipients(new.buddy_read_id, new.author_id)));
  return null;
end;
$$;

create trigger buddy_messages_live_new
  after insert on public.buddy_messages
  for each row execute function private.buddy_message_new();

create or replace function private.buddy_message_deleted()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  perform private.buddy_send(
    'message.deleted',
    jsonb_build_object('id', new.id, 'buddy_read_id', new.buddy_read_id, 'section_id', new.section_id),
    array(select private.buddy_recipients(new.buddy_read_id, new.author_id)));
  return null;
end;
$$;

create trigger buddy_messages_live_deleted
  after update of deleted_at on public.buddy_messages
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.buddy_message_deleted();

-- A reaction set, changed or removed. Nothing when its message is going (a deleted read, a deleted
-- author, a member leaving with her messages) or the reacting member's account is.
create or replace function private.buddy_reaction_live()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row    public.buddy_reactions;
  v_read   uuid;
  v_author uuid;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  select buddy_read_id, author_id into v_read, v_author from public.buddy_messages where id = v_row.message_id;
  if v_read is null
     or (tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = v_row.member_id)) then
    return null;
  end if;
  perform private.buddy_send(
    'message.reaction',
    jsonb_build_object('message_id', v_row.message_id, 'buddy_read_id', v_read, 'member_id', v_row.member_id,
                       'emoji', case when tg_op = 'DELETE' then null else v_row.emoji end),
    array(select r from private.buddy_recipients(v_read, v_row.member_id) r
           where not private.buddy_hidden(r, v_author)));
  return null;
end;
$$;

create trigger buddy_reactions_live
  after insert or update of emoji or delete on public.buddy_reactions
  for each row execute function private.buddy_reaction_live();

-- -------------------------------------------------------------------------- members

-- Joined, left, removed, accepted, the role, her Section (read_through): buddy_read.changed. Invited,
-- or her invitation gone: buddy.invitation to her alone. The update trigger's condition keeps the
-- cursors (last_read_at) and a change that leaves read_through as it was from calling this at all.
create or replace function private.buddy_member_live()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row public.buddy_read_members;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  if tg_op <> 'UPDATE' and v_row.joined_at is null then
    -- An invitation made, or one declined or withdrawn. Not when her account or the read is going.
    if exists (select 1 from public.buddy_reads where id = v_row.buddy_read_id)
       and exists (select 1 from auth.users u where u.id = v_row.member_id) then
      perform private.buddy_send('buddy.invitation',
                                 jsonb_build_object('buddy_read_id', v_row.buddy_read_id),
                                 array[v_row.member_id]);
    end if;
    return null;
  end if;
  perform private.buddy_changed(v_row.buddy_read_id, v_row.member_id);
  return null;
end;
$$;

create trigger buddy_read_members_live_insert
  after insert on public.buddy_read_members
  for each row execute function private.buddy_member_live();

create trigger buddy_read_members_live_update
  after update of joined_at, role, auto_through, hand_through on public.buddy_read_members
  for each row when (
    new.joined_at is not null
    and (old.joined_at is distinct from new.joined_at
         or old.role is distinct from new.role
         or old.read_through is distinct from new.read_through))
  execute function private.buddy_member_live();

create trigger buddy_read_members_live_delete
  after delete on public.buddy_read_members
  for each row execute function private.buddy_member_live();

-- -------------------------------------------------------------------------- the read and its Sections

create or replace function private.buddy_read_live()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  perform private.buddy_changed(new.id, null);
  return null;
end;
$$;

create trigger buddy_reads_live_status
  after update of status on public.buddy_reads
  for each row when (old.status is distinct from new.status)
  execute function private.buddy_read_live();

-- Once per statement and read, whatever the number of Sections it wrote (a new division is a delete
-- and an insert of every Section).
create or replace function private.buddy_sections_live()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_read uuid;
begin
  if tg_op = 'DELETE' then
    for v_read in select distinct buddy_read_id from old_rows loop
      perform private.buddy_changed(v_read, null);
    end loop;
  else
    for v_read in select distinct buddy_read_id from new_rows loop
      perform private.buddy_changed(v_read, null);
    end loop;
  end if;
  return null;
end;
$$;

create trigger buddy_read_sections_live_insert
  after insert on public.buddy_read_sections
  referencing new table as new_rows
  for each statement execute function private.buddy_sections_live();

create trigger buddy_read_sections_live_update
  after update on public.buddy_read_sections
  referencing new table as new_rows
  for each statement execute function private.buddy_sections_live();

create trigger buddy_read_sections_live_delete
  after delete on public.buddy_read_sections
  referencing old table as old_rows
  for each statement execute function private.buddy_sections_live();

-- -------------------------------------------------------------------------- grants

-- Nothing here is for the API. The topic function keeps the one grant above, for the policy.
revoke all on function private.buddy_recipients(uuid, uuid) from public, anon, authenticated;
revoke all on function private.buddy_send(text, jsonb, uuid[]) from public, anon, authenticated;
revoke all on function private.buddy_changed(uuid, uuid) from public, anon, authenticated;
revoke all on function private.buddy_message_new() from public, anon, authenticated;
revoke all on function private.buddy_message_deleted() from public, anon, authenticated;
revoke all on function private.buddy_reaction_live() from public, anon, authenticated;
revoke all on function private.buddy_member_live() from public, anon, authenticated;
revoke all on function private.buddy_read_live() from public, anon, authenticated;
revoke all on function private.buddy_sections_live() from public, anon, authenticated;
