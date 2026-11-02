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
-- row's read_through is used.)
--
-- Locks. buddy_refresh takes the read's advisory lock (D1's lock 2) so it serialises with
-- set_buddy_sections and sees the new Sections. The progress triggers hold no buddy lock before it,
-- so taking 2 alone is order-safe; where one entry is linked in several reads they are taken in the
-- order of their ids. buddy_refresh never takes the member lock (1). The member trigger skips an
-- unlink (nothing to compute there). One narrow cycle remains: update_progress holds her entry
-- row (for update) and then waits for the read's lock, while link_buddy_entry holds the read's lock
-- and then waits for the key share of the same entry row; Postgres detects it and fails one of the
-- two with 40P01, retryable (a member working in two apps at the same second on the same entry).
--
-- Cost. A progress update by a member in no buddy read does one index probe on
-- buddy_read_members(entry_id) (the partial index buddy_read_members_entry) and writes nothing. The
-- reading_sessions trigger skips updates that change none of the columns it follows; the
-- library_entries one skips an update that changes neither the Book nor the override.
--
-- Left out: Realtime events for a changed Section (D4: its member-row trigger fires on read_through,
-- whatever wrote it), messages (D3), any change to a D1 function, to update_progress, finish_reading,
-- start_reading, change_edition or to a follower-facing function. Not followed: a change to a Book's
-- own page_count (enrichment) does not refresh the rooms of members who read it; her next progress
-- update does.
--
-- Differences from the brief, all deliberate: reading_sessions also has an after delete trigger
-- (delete_session removes a session that may be the one that counts); the buddy_read_sections update
-- trigger has no column list (Postgres refuses transition tables on one) and the function looks for a
-- changed to_fraction or kind itself; the sections delete trigger leaves a read with no Section at
-- all alone (set_buddy_sections deletes and inserts in one call and the insert refreshes, and a read
-- being deleted is not refreshed).

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

-- Recompute one joined member's auto_through from her linked entry. Under the read's lock; writes
-- only when the number changes.
create or replace function private.buddy_refresh(p_read uuid, p_member uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_m       public.buddy_read_members;
  v_f       numeric;
  v_through smallint;
begin
  perform private.buddy_lock_read(p_read);

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

  v_f := private.buddy_fraction(v_m.entry_id, v_m.joined_at);
  if v_f is not null then
    select count(*)::smallint into v_through
      from public.buddy_read_sections s
     where s.buddy_read_id = p_read and s.kind = 'part' and s.to_fraction <= v_f + 0.005;
  end if;

  if v_through is distinct from v_m.auto_through then
    update public.buddy_read_members set auto_through = v_through
     where buddy_read_id = p_read and member_id = p_member;
  end if;
end;
$$;

-- Every joined membership linked to this entry (one entry can sit in several reads: ids in order).
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
  new.hand_through := greatest(coalesce(old.hand_through, 0), old.read_through);
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
