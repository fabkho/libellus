-- Buddy reads, D2: a member's Section from her reading progress (docs/plans/buddy-read-shared.md part 5).
--
-- D1 stores a member's position as buddy_read_members.auto_through (the Sections her progress has
-- completed), hand_through (the Sections she says she has read) and the generated read_through (the
-- greater), and shows the other members only a `where` Section. Nothing wrote auto_through. This
-- migration does, from the progress of the Library entry she linked: the number of `part` Sections
-- whose end the book's fraction she has read has reached, kept current by triggers.
--
-- The exception to social v1's promise. Social v1 (20261017040000_social_readers.sql) says a member's
-- progress never leaves her account, and every follower-facing function (member_card, member_profile,
-- the feed, both_read, member_reading_record, the reading page) still shows none and reads none of
-- these tables. The one exception is a buddy read she joined: buddy_read() shows its other joined
-- members her Section (`where`: section k, end, or not_set) and nothing it was worked out from, no
-- page, percent, fraction, date, outcome, entry, or whether the Section came from her progress or
-- her hand. Her Section is itself a coarse fact about her progress, so the old sentence is not true
-- of a joined member any more; the wording that says so is P1's. Nothing here adds a number to any
-- function.
--
-- What this migration adds:
--   private.buddy_auto(read, member row)    her Sections done, read-only (the first pass of the refresh)
--   private.buddy_fraction(entry, joined)   the fraction of the book she has read (plan 5.2)
--   private.buddy_refresh(read, member)     recompute her auto_through, under the read's lock
--   private.buddy_refresh_entry(entry)      every joined membership linked to an entry
--   private.buddy_refresh_read(read)        every joined member of a read
--   triggers (all security definer, no execute for members):
--     reading_sessions     after insert / update of the progress columns / delete: her entry's rooms
--     library_entries      after update of book_id, page_count_override: the same (edition, own total)
--     buddy_read_members   after update of entry_id, joined_at: that member; before update of entry_id:
--                          an unlinked or removed entry freezes her Section (hand = what it was)
--     buddy_read_sections  after insert / update / delete, per statement: the read's members
--
-- The rule (plan 5.2). The session that counts is the entry's open session (outcome is null), else
-- the latest closed one whose coalesce(ended_on, started_on) is on or after the day she joined, else
-- none (the fraction is null: no automatic position). finished -> 1; progress_page -> page over
-- coalesce(entry.page_count_override, book.page_count), at most 1, null with no page count anywhere;
-- progress_percent -> percent / 100; a session without progress -> 0. auto_through is the number of
-- `part` Sections with to_fraction <= fraction + 0.005 (null when the fraction is). A session that
-- finished or was given up before she joined is not counted; a new open session (a re-read) wins
-- over a finished one, so her Section falls back; her hand override is the remedy.
--
-- Known fuzz, kept as the plan writes it. joined_at is a timestamptz and its date here is the UTC
-- date; a session's started_on and ended_on are the member's own local dates (update_progress allows
-- a day one either side of UTC today). A member far from UTC who finishes a closed session on the day
-- she joins can therefore be counted or not counted by one day at the boundary. Not "fixed" here.
--
-- Unlinking, removing the entry from her Library (the foreign key's on delete set null fires the same
-- trigger) or deleting it freeze her Section: before entry_id becomes null, hand_through becomes
-- greatest(hand_through, read_through) and auto_through null, so nothing silently opens or closes and
-- she can change it by hand. (A generated column is not computed yet in a before trigger: the old
-- row's read_through is used.) Nothing is written when there is nothing to keep: with no hand value and
-- read_through 0 (never set, or linked but not begun) the hand stays null, so `where` is `not_set` after
-- the unlink, never `section 1` made up from a 0. (A linked member who has begun but has no progress was
-- shown Section 1; unlinked she is shown not_set: there is no place left to show.)
--
-- Linking again, to the same or another copy, recomputes auto_through from that copy; a frozen hand
-- stays. The rule: hand_through is changed only by her (set_buddy_hand, null clears it) or by the host's
-- replaced division (clamped), never by progress, so a relink to a copy with less progress does not move
-- her back: read_through is still the greater of the two. She lowers or clears her hand to go back.
--
-- Which rooms follow progress. Progress-driven refreshes (a session written, an edition or own total
-- changed) touch only ACTIVE rooms: a finished or archived room keeps the Section it ended with, a
-- progress update by a member of one neither errors nor moves it. Her explicit acts (link, accept, the
-- host's division) recompute whatever the room's status, except that D1 refuses them in an archived room.
--
-- Locks. The order, for everything that touches a linked entry (new in D2, and link_buddy_entry is
-- replaced below to follow it):
--   (member lock 1, where a function takes it)  ->  her ENTRY row  ->  the read's lock 2  ->  member rows.
-- update_progress, finish_reading, abandon_reading, read_again and change_edition already lock her entry
-- row (for update) before writing a session, so the progress triggers run with the entry locked.
-- buddy_refresh computes her Section first, read-only, and returns when it is unchanged (the usual
-- case for a progress update: no lock at all, nothing waits behind a room's chat traffic); only a
-- changed Section takes the read's lock, computes again under it (it serialises with set_buddy_sections
-- and sees the new Sections) and writes. Where one entry is linked in several reads the locks are taken
-- in the order of their ids. buddy_refresh never takes the member lock (1).
-- link_buddy_entry used to take the read's lock first and then needed a key share of her entry row
-- (the foreign key check of the new entry_id), against update_progress holding that row and waiting for
-- the read's lock: a deadlock (40P01). The replacement below locks her entry row (for no key update:
-- it conflicts with the for update of update_progress and change_edition) before the read's lock, and
-- is otherwise D1's function (same signature, grants kept, search_path pinned).
-- The member trigger skips an unlink (nothing to compute there) and the refresh skips an entry that is
-- already deleted, so deleting an entry or an account never waits for a room's lock.
-- Residual and accepted: the first, unlocked pass can miss a Section change that another transaction
-- (set_buddy_sections, at setup: D3 closes it once a Section has messages) has made but not committed,
-- at the very moment of a progress write that did not move her Section by the old division. Her Section
-- is then computed from the old progress until her next progress write, a link, or the next change of
-- the division; her hand override is the way out.
--
-- Cost. A progress update by a member in no buddy read does one index probe on
-- buddy_read_members(entry_id) (the partial index buddy_read_members_entry) and writes nothing. The
-- reading_sessions trigger skips updates that change none of the columns it follows; the
-- library_entries one skips an update that changes neither the Book nor the override. One in a room
-- whose Section does not move reads her sessions and the room's Sections, takes no lock, writes nothing.
-- Bulk import: import_books (and so the import job, which calls it per row) only ever adds an entry for
-- a Book she does not have, and a new entry has no membership: its sessions cost the one probe and no
-- lock; an entry she already has "stays as it is" and gets no session. Known limit, should a bulk write
-- of sessions of linked entries ever exist: each room whose Section moves is locked until the commit.
--
-- Left out: Realtime events for a changed Section (D4: its member-row trigger fires on read_through,
-- whatever wrote it), messages (D3), any change to a D1 function (but the lock order of link_buddy_entry), to update_progress, finish_reading,
-- start_reading, change_edition or to a follower-facing function. Not followed: a change to a Book's
-- own page_count (enrichment) does not refresh the rooms of members who read it; her next progress
-- update does.
--
-- Differences from the brief, all deliberate: reading_sessions also has an after delete trigger
-- (delete_session removes a session that may be the one that counts); the buddy_read_sections update
-- trigger has no column list (Postgres refuses transition tables on one) and the function looks for a
-- changed to_fraction or kind itself; the sections delete trigger leaves a read with no Section at
-- all alone (set_buddy_sections deletes and inserts in one call and the insert refreshes, and a read
-- being deleted is not refreshed); public.link_buddy_entry is replaced, for its lock order only (above).

-- -------------------------------------------------------------------------- the fraction

-- The fraction (0 to 1) of the Book she has read, from the session that counts, or null.
create or replace function private.buddy_fraction(p_entry uuid, p_joined timestamptz)
returns numeric
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_session public.reading_sessions;
  v_pages   integer;
begin
  if p_entry is null or p_joined is null then
    return null;
  end if;

  select s.* into v_session
    from public.reading_sessions s
   where s.entry_id = p_entry
     and (s.outcome is null
          or coalesce(s.ended_on, s.started_on) >= (p_joined at time zone 'utc')::date)
   order by (s.outcome is null) desc, coalesce(s.ended_on, s.started_on) desc, s.created_at desc, s.id
   limit 1;
  if not found then
    return null;
  end if;

  if v_session.outcome = 'finished' then
    return 1;
  end if;
  if v_session.progress_page is not null then
    select coalesce(e.page_count_override, b.page_count) into v_pages
      from public.library_entries e
      join public.books b on b.id = e.book_id
     where e.id = p_entry;
    if v_pages is null then
      return null;
    end if;
    return least(1::numeric, v_session.progress_page::numeric / v_pages);
  end if;
  if v_session.progress_percent is not null then
    return v_session.progress_percent::numeric / 100;
  end if;
  return 0;
end;
$$;

comment on function private.buddy_fraction(uuid, timestamptz) is
  'D2: the fraction (0 to 1) of the Book a Library entry has been read, for a member who joined a buddy read '
  'at p_joined: the open session, else the latest closed one on or after the (UTC) day she joined, else null; '
  'finished = 1, a page over the entry''s own total or the Book''s, a percent over 100, no progress = 0. Never '
  'shown to anyone: only the Sections it completes are.';

-- -------------------------------------------------------------------------- the refresh

-- The Sections a member's progress has completed: null when she has no linked entry or no fraction.
create or replace function private.buddy_auto(p_read uuid, p_m public.buddy_read_members)
returns smallint
language plpgsql
stable
set search_path = pg_catalog, public, private
as $$
declare
  v_f numeric := private.buddy_fraction(p_m.entry_id, p_m.joined_at);
begin
  if v_f is null then
    return null;
  end if;
  return (select count(*)::smallint from public.buddy_read_sections s
           where s.buddy_read_id = p_read and s.kind = 'part' and s.to_fraction <= v_f + 0.005);
end;
$$;

-- Recompute one joined member's auto_through from her linked entry. A first pass without a lock: when
-- nothing changes, that is all. Otherwise under the read's lock, again; written only on a change.
create or replace function private.buddy_refresh(p_read uuid, p_member uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_m public.buddy_read_members;
begin
  for v_pass in 1 .. 2 loop
    select * into v_m from public.buddy_read_members
     where buddy_read_id = p_read and member_id = p_member and joined_at is not null;
    if not found then
      return;
    end if;
    -- An entry that is already deleted: the foreign key's set null is on its way and freezes her
    -- Section first (the before trigger below); do not move it now.
    if v_m.entry_id is not null
       and not exists (select 1 from public.library_entries where id = v_m.entry_id) then
      return;
    end if;

    if private.buddy_auto(p_read, v_m) is not distinct from v_m.auto_through then
      return;
    end if;
    if v_pass = 1 then
      perform private.buddy_lock_read(p_read);
    else
      update public.buddy_read_members set auto_through = private.buddy_auto(p_read, v_m)
       where buddy_read_id = p_read and member_id = p_member;
    end if;
  end loop;
end;
$$;

-- Every joined membership linked to this entry, in an active read (one entry can sit in several reads:
-- ids in order). A finished or archived read keeps the Section it ended with.
create or replace function private.buddy_refresh_entry(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row record;
begin
  for v_row in
    select m.buddy_read_id, m.member_id
      from public.buddy_read_members m
      join public.buddy_reads r on r.id = m.buddy_read_id and r.status = 'active'
     where m.entry_id = p_entry and m.joined_at is not null
     order by m.buddy_read_id, m.member_id
  loop
    -- An entry that is being deleted (its sessions go with it) is the foreign key's to settle, and
    -- the read's lock is not taken for it.
    if exists (select 1 from public.library_entries where id = p_entry) then
      perform private.buddy_refresh(v_row.buddy_read_id, v_row.member_id);
    end if;
  end loop;
end;
$$;

-- Every joined member of a read who has a copy linked.
create or replace function private.buddy_refresh_read(p_read uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_member uuid;
begin
  perform private.buddy_lock_read(p_read);
  for v_member in
    select m.member_id from public.buddy_read_members m
     where m.buddy_read_id = p_read and m.joined_at is not null and m.entry_id is not null
     order by m.member_id
  loop
    perform private.buddy_refresh(p_read, v_member);
  end loop;
end;
$$;

-- -------------------------------------------------------------------------- triggers: progress

create or replace function private.buddy_on_session()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  perform private.buddy_refresh_entry(case when tg_op = 'DELETE' then old.entry_id else new.entry_id end);
  return null;
end;
$$;

create trigger buddy_refresh_on_session_insert
  after insert on public.reading_sessions
  for each row execute function private.buddy_on_session();

create trigger buddy_refresh_on_session_update
  after update of progress_page, progress_percent, outcome, ended_on, started_on
  on public.reading_sessions
  for each row
  when ((old.progress_page, old.progress_percent, old.outcome, old.ended_on, old.started_on)
        is distinct from (new.progress_page, new.progress_percent, new.outcome, new.ended_on, new.started_on))
  execute function private.buddy_on_session();

create trigger buddy_refresh_on_session_delete
  after delete on public.reading_sessions
  for each row execute function private.buddy_on_session();

create or replace function private.buddy_on_entry()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  perform private.buddy_refresh_entry(new.id);
  return null;
end;
$$;

create trigger buddy_refresh_on_entry_change
  after update of book_id, page_count_override on public.library_entries
  for each row
  when (old.book_id is distinct from new.book_id
        or old.page_count_override is distinct from new.page_count_override)
  execute function private.buddy_on_entry();

-- -------------------------------------------------------------------------- triggers: members

-- Linked, joined or accepted: that member's Section. An unlink has nothing to compute.
create or replace function private.buddy_on_member_link()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  perform private.buddy_refresh(new.buddy_read_id, new.member_id);
  return null;
end;
$$;

create trigger buddy_refresh_on_member_link
  after update of entry_id, joined_at on public.buddy_read_members
  for each row
  when (new.entry_id is not null
        and (old.entry_id is distinct from new.entry_id or old.joined_at is distinct from new.joined_at))
  execute function private.buddy_on_member_link();

-- Unlinked, or her entry removed (the foreign key's set null): her Section stays where it was.
create or replace function private.buddy_on_member_unlink()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  -- Nothing to keep (no hand value, read_through 0): the hand stays null and `where` becomes not_set.
  if old.hand_through is not null or old.read_through > 0 then
    new.hand_through := greatest(coalesce(old.hand_through, 0), old.read_through);
  end if;
  new.auto_through := null;
  return new;
end;
$$;

create trigger buddy_freeze_on_member_unlink
  before update of entry_id on public.buddy_read_members
  for each row
  when (new.entry_id is null and old.entry_id is not null)
  execute function private.buddy_on_member_unlink();

-- -------------------------------------------------------------------------- triggers: Sections

-- Per statement (transition tables cannot be shared between events): the reads whose Sections changed.
-- This is what makes set_buddy_sections (a replace) and create_buddy_read (the host's copy may already
-- have progress) right without touching either.
create or replace function private.buddy_on_sections_inserted()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_read uuid;
begin
  for v_read in select distinct n.buddy_read_id from new_rows n order by 1 loop
    perform private.buddy_refresh_read(v_read);
  end loop;
  return null;
end;
$$;

create or replace function private.buddy_on_sections_updated()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_read uuid;
begin
  for v_read in
    select distinct n.buddy_read_id
      from new_rows n
      join old_rows o on o.id = n.id
     where o.to_fraction is distinct from n.to_fraction or o.kind is distinct from n.kind
     order by 1
  loop
    perform private.buddy_refresh_read(v_read);
  end loop;
  return null;
end;
$$;

-- Only a read that still has Sections and still exists: a replace deletes them all and inserts the new
-- ones, whose insert refreshes; a read being deleted takes its members with it.
create or replace function private.buddy_on_sections_deleted()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_read uuid;
begin
  for v_read in
    select distinct o.buddy_read_id
      from old_rows o
     where exists (select 1 from public.buddy_reads r where r.id = o.buddy_read_id)
       and exists (select 1 from public.buddy_read_sections s where s.buddy_read_id = o.buddy_read_id)
     order by 1
  loop
    perform private.buddy_refresh_read(v_read);
  end loop;
  return null;
end;
$$;

create trigger buddy_refresh_on_sections_insert
  after insert on public.buddy_read_sections
  referencing new table as new_rows
  for each statement execute function private.buddy_on_sections_inserted();

create trigger buddy_refresh_on_sections_update
  after update on public.buddy_read_sections
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.buddy_on_sections_updated();

create trigger buddy_refresh_on_sections_delete
  after delete on public.buddy_read_sections
  referencing old table as old_rows
  for each statement execute function private.buddy_on_sections_deleted();

-- -------------------------------------------------------------------------- link_buddy_entry: lock order

-- D1's function with one change: her entry row is locked (for no key update, which conflicts with the
-- for update of update_progress, finish_reading and change_edition) BEFORE the read's lock, as
-- update_progress does, so the two cannot wait for each other (see "Locks" above). The body is
-- otherwise D1's, word for word.
create or replace function public.link_buddy_entry(p_id uuid, p_entry uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_me     public.buddy_read_members;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_gate(p_id, v_caller);
  -- Her entry first (an entry that is not hers or not there is refused below, as before).
  if p_entry is not null then
    perform 1 from public.library_entries where id = p_entry and member_id = v_caller for no key update;
  end if;
  perform private.buddy_lock_read(p_id);
  perform private.buddy_gate(p_id, v_caller);
  if (select status from public.buddy_reads where id = p_id) = 'archived' then
    raise exception 'buddy_read_archived' using errcode = 'PT409';
  end if;

  if p_entry is not null and not exists (
    select 1
      from public.library_entries e
      join public.books eb on eb.id = e.book_id
      join public.buddy_reads r on r.id = p_id
      join public.books rb on rb.id = r.book_id
     where e.id = p_entry and e.member_id = v_caller
       and (eb.id = rb.id
            or (rb.openlibrary_work_key is not null and eb.openlibrary_work_key = rb.openlibrary_work_key
                and not eb.check_failed and not rb.check_failed))
  ) then
    raise exception 'buddy_entry_invalid' using errcode = '22023';
  end if;

  update public.buddy_read_members set entry_id = p_entry
   where buddy_read_id = p_id and member_id = v_caller
  returning * into v_me;
  return private.buddy_me(v_me, private.buddy_parts(p_id));
end;
$$;

-- -------------------------------------------------------------------------- what a co-member sees

comment on function public.buddy_read(uuid) is
  'A buddy read for one of its joined members: its Sections, its joined members, her own place. A co-member '
  'is shown as a card and her Section only (`where`: section k, end or not_set; null between a blocked pair), '
  'never a page, percent, fraction, date, outcome, entry or what her Section was worked out from. `me`, for '
  'herself alone, carries her entry id and her auto and hand numbers.';

comment on function private.buddy_where(public.buddy_read_members, integer) is
  'Where a member is as the other members of her read see it: section k (she is reading Section read_through + 1), '
  'end (every part read) or not_set (no copy linked and nothing set). It says nothing of whether the Section came '
  'from her progress (D2) or her hand, and it is never a number about her reading.';

-- -------------------------------------------------------------------------- grants

revoke all on function private.buddy_fraction(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.buddy_auto(uuid, public.buddy_read_members) from public, anon, authenticated;
revoke all on function private.buddy_refresh(uuid, uuid) from public, anon, authenticated;
revoke all on function private.buddy_refresh_entry(uuid) from public, anon, authenticated;
revoke all on function private.buddy_refresh_read(uuid) from public, anon, authenticated;
revoke all on function private.buddy_on_session() from public, anon, authenticated;
revoke all on function private.buddy_on_entry() from public, anon, authenticated;
revoke all on function private.buddy_on_member_link() from public, anon, authenticated;
revoke all on function private.buddy_on_member_unlink() from public, anon, authenticated;
revoke all on function private.buddy_on_sections_inserted() from public, anon, authenticated;
revoke all on function private.buddy_on_sections_updated() from public, anon, authenticated;
revoke all on function private.buddy_on_sections_deleted() from public, anon, authenticated;
