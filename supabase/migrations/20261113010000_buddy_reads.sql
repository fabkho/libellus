-- Buddy reads, D1: rooms, members and Sections (docs/plans/buddy-read-shared.md parts 4 and 5).
--
-- A buddy read is one Book read together by 2 to 12 Members in a room, divided into Sections. A
-- Member starts one (she is its Host) for a Catalogue Book she holds in her Library, invites people
-- she follows or turns on a link, and the others join. Each joined Member has a Position: the Section
-- she is in, shown to the other members of that read as a Section only (`section k`, `end`,
-- `not set`), never a page, a percent, a fraction or a date.
--
-- What this migration adds:
--   tables   public.buddy_reads, public.buddy_read_members, public.buddy_read_sections, private.buddy_calls,
--            private.buddy_read_removed.
--            RLS on, no policies, nothing granted to anon or authenticated (the default privileges of this
--            project grant every new public table to both, so the revoke is explicit): every read and write
--            is one of the functions below, which first proves the caller is a joined member.
--   helpers  private.buddy_active_count, private.buddy_co_members,
--            private.buddy_sections_parse, private.buddy_rate, private.buddy_where, private.buddy_invite,
--            private.buddy_lock_member, private.buddy_lock_read, private.buddy_card;
--            the trigger private.buddy_member_gone (host handover, an empty read deleted).
--   RPCs     create_buddy_read, my_buddy_reads, buddy_read, invite_to_buddy_read, buddy_read_link,
--            buddy_read_target, join_buddy_read, answer_buddy_invite, leave_buddy_read,
--            remove_from_buddy_read, finish_buddy_read, archive_buddy_read, set_buddy_sections,
--            link_buddy_entry, set_buddy_hand.
--   change   private.can_see_photo gains "or private.buddy_co_members(caller, owner)": the members of one
--            read see each other's photo without a follow while both are in it and neither blocked the
--            other. The avatar storage policy reads it through public.can_see_member_folder and
--            public.can_see_member_file, which change with it and need nothing else.
--            public.delete_my_account takes the locks of her reads before it deletes her (below).
--
-- A block between two members of a read removes neither, but stops position sharing between them at
-- once: in buddy_read each one's `where` is null to the other (both ways; everyone else still sees it),
-- and the card is what the social functions show a blocked pair (name, no photo). my_buddy_reads shows
-- only her own place, and buddy_read_target answers null to anyone blocked with any member, so neither
-- shows another member's place at all. Messages stop between them with D3.
--
-- Removal sticks: remove_from_buddy_read leaves a marker in private.buddy_read_removed, and while it
-- is there the link answers her as any bad link does (buddy_read_target null, join_buddy_read
-- not_found), never saying she was removed. Only a new invitation from the host clears it.
--
-- my_buddy_reads answers every active read of hers, the 20 most recent ended ones and the 50 newest
-- invitations. Ended reads are not capped per member: each one is a row of hers that only a create (20 an
-- hour) or a join (30 an hour) adds, leaving deletes it, and the list never grows past those bounds.
--
-- What it leaves out: messages, reactions, reports, Section cursors and unread counts (D3: `count`
-- and `unread` answer 0 until then, and leave_buddy_read's p_delete_messages does nothing yet); the
-- Section worked out from reading progress (D2: nothing here writes auto_through, nothing reads
-- reading_sessions); the Realtime policy and triggers (D4). The follower-facing functions
-- (member_card, member_profile, the feed, both_read, the reading page) are not changed and read
-- none of these tables: a member's progress stays out of all of them.
--
-- Refusals, as stable messages (the client maps by message): not_signed_in 42501; not_found PT404
-- (no such read, not a joined member, a bad or blocked token: one answer, so a read's existence is
-- never revealed); not_host PT403; rate_limited and buddy_read_limit PT429; buddy_read_exists,
-- buddy_read_full, buddy_read_ended, buddy_read_archived PT409; 22023 for invalid input
-- (client_id_required, buddy_book_invalid, buddy_sections_invalid, buddy_entry_invalid,
-- buddy_position_invalid, buddy_starts_invalid, buddy_remove_self).
--
-- Limits: a member hosts at most one active read per Book; she is in at most 10 active reads; a
-- read holds at most 12 rows, joined members and waiting invitations alike; create and invite
-- 20 calls an hour each, join by link 30 an hour (private.buddy_calls, the private.follow_calls
-- pattern: purge, count, insert, under her own lock).
--
-- Lock order (advisory, transaction scoped), always in this order and never back:
--   1. the caller's member lock  hashtextextended('buddy:' || member, 0)       her rate limits and her
--                                                                              10-read limit;
--   2. the read's lock           hashtextextended('buddy_read:' || read, 0)   every change to a read's
--                                                                              rows, the cap of 12;
--   3. row locks.
-- create takes 1 (its read is new); invite, join and accept take 1 then 2; leave, remove, finish,
-- archive, link, Sections, entry and hand take 2 only. Two joins at once queue on 2 and the second
-- counts the first's row: the cap cannot be passed. A check made before a lock is made again after
-- it (a block, the token, the status may have changed while waiting). The trigger
-- private.buddy_member_gone takes 2 as well; when it runs inside an account deletion the cascade
-- already holds that member's row locks, so a host removing the same member at the same moment can
-- meet it in a deadlock. So can an invite or a join whose insert waits for the key-share lock on her
-- auth.users row while her account deletion holds that row and waits, in the trigger, for the read's
-- lock the invite holds; and two account deletions of members who share two reads. delete_my_account
-- therefore takes the locks of all her reads first, in the order of their ids, before it deletes
-- anything (2 before 3, as everywhere): those three cases then queue instead. An account deleted any
-- other way (the Auth admin API, the dashboard) skips that step; there Postgres detects the deadlock
-- and fails one of the two with 40P01, and the caller retries. The handover never raises: a host_id
-- that would break a uniqueness rule stays null, and the new host is host by her row.
--
-- Changes to the plan's part 4 (the PR says why): create_buddy_read and set_buddy_sections take two
-- more trailing arguments, p_from (sections_from) and p_page_count, which the plan's table stores
-- but its signatures had no way to receive; set_buddy_hand takes an integer, not a smallint (a
-- smallint argument is not found from SQL with a plain number); invited_at defaults to
-- clock_timestamp(), and buddy_read_members.invited_by is indexed (every foreign key is); a read has
-- one host row (a partial unique index) and a host row is a joined one (a check); "one active read
-- per host and Book" is decided by the host's row, so it holds for a host whose host_id stayed null;
-- a Catalogue Book that failed its check is refused too (its title is hidden from the other members);
-- private.buddy_read_removed keeps a removal; public.delete_my_account takes the read locks first.

-- -------------------------------------------------------------------------- tables

create table public.buddy_reads (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.books (id) on delete restrict,
  host_id       uuid references auth.users (id) on delete set null,
  status        text not null default 'active' check (status in ('active', 'finished', 'archived')),
  starts_on     date not null default current_date,
  link_token    text unique check (link_token ~ '^[A-Za-z0-9_-]{22}$'),
  sections_from text not null default 'count' check (sections_from in ('count', 'pages', 'list')),
  page_count    integer check (page_count between 1 and 99999),
  client_id     uuid not null,
  created_at    timestamptz not null default clock_timestamp(),
  finished_at   timestamptz,
  archived_at   timestamptz,
  unique (host_id, client_id)
);

create unique index buddy_reads_one_active on public.buddy_reads (host_id, book_id) where status = 'active';
create index buddy_reads_book on public.buddy_reads (book_id);

comment on table public.buddy_reads is
  'Buddy reads (20261113010000): one Book read together by up to 12 Members, divided into Sections. '
  'book_id is the edition the Sections were cut from, a Catalogue Book. host_id is the Host for the '
  'uniqueness rules (one active read per host and Book, an idempotent create); her member row says '
  'role = host. link_token: null = the link is off. Read and written only through the buddy read functions.';

create table public.buddy_read_members (
  buddy_read_id uuid not null references public.buddy_reads (id) on delete cascade,
  member_id     uuid not null references auth.users (id) on delete cascade,
  role          text not null default 'member' check (role in ('host', 'member')),
  invited_by    uuid references auth.users (id) on delete set null,
  invited_at    timestamptz not null default clock_timestamp(),
  joined_at     timestamptz,
  entry_id      uuid references public.library_entries (id) on delete set null,
  auto_through  smallint check (auto_through >= 0),
  hand_through  smallint check (hand_through >= 0),
  read_through  smallint generated always as (greatest(coalesce(auto_through, 0), coalesce(hand_through, 0))) stored,
  last_read_at  timestamptz,
  primary key (buddy_read_id, member_id),
  check (role = 'member' or joined_at is not null)
);

create index buddy_read_members_member on public.buddy_read_members (member_id);
create unique index buddy_read_members_one_host on public.buddy_read_members (buddy_read_id) where role = 'host';
create index buddy_read_members_entry on public.buddy_read_members (entry_id) where entry_id is not null;
create index buddy_read_members_invited_by on public.buddy_read_members (invited_by) where invited_by is not null;

comment on table public.buddy_read_members is
  'Buddy reads: who is in a read. joined_at null = invited, not answered; only joined members count, '
  'read and write. entry_id is her copy (what makes her Section automatic, D2). auto_through: Sections '
  'completed by her progress (D2; null = unknown); hand_through: Sections she says she completed; '
  'read_through: the greater. Shown to the other members only as a Section (private.buddy_where).';

create table public.buddy_read_sections (
  id            uuid primary key default gen_random_uuid(),
  buddy_read_id uuid not null references public.buddy_reads (id) on delete cascade,
  position      smallint not null check (position between 1 and 101),
  kind          text not null default 'part' check (kind in ('part', 'end')),
  label         text not null check (char_length(label) between 1 and 120),
  start_page    integer,
  end_page      integer,
  to_fraction   numeric(5, 4) not null check (to_fraction > 0 and to_fraction <= 1),
  unique (buddy_read_id, position) deferrable initially deferred,
  check ((start_page is null) = (end_page is null) and (start_page is null or end_page >= start_page)),
  check (kind = 'part' or to_fraction = 1)
);

create unique index buddy_read_sections_one_end on public.buddy_read_sections (buddy_read_id) where kind = 'end';

comment on table public.buddy_read_sections is
  'Buddy reads: the Sections of a read, in order. to_fraction is where a Section ends, as a fraction of '
  'the Book; the last is always the one end Section, "The whole book" (to_fraction = 1). Labels are the '
  'host''s text; pages are optional, in the read''s edition, for the label.';

-- Calls of create, invite and join by link, for the hourly limits; rows older than an hour are
-- deleted by the next call of that member and kind.
create table private.buddy_calls (
  member_id uuid not null references auth.users (id) on delete cascade,
  kind      text not null,
  at        timestamptz not null default now()
);

create index buddy_calls_member_at on private.buddy_calls (member_id, kind, at);

-- Members the host removed from a read: the link does not let them back in until she invites them again.
create table private.buddy_read_removed (
  buddy_read_id uuid not null references public.buddy_reads (id) on delete cascade,
  member_id     uuid not null references auth.users (id) on delete cascade,
  removed_at    timestamptz not null default clock_timestamp(),
  primary key (buddy_read_id, member_id)
);

create index buddy_read_removed_member on private.buddy_read_removed (member_id);

alter table public.buddy_reads enable row level security;
alter table public.buddy_read_members enable row level security;
alter table public.buddy_read_sections enable row level security;
alter table private.buddy_calls enable row level security;
alter table private.buddy_read_removed enable row level security;

-- Supabase grants every new public table to the API roles; these want none. No policies either.
revoke all on public.buddy_reads from anon, authenticated;
revoke all on public.buddy_read_members from anon, authenticated;
revoke all on public.buddy_read_sections from anon, authenticated;

-- -------------------------------------------------------------------------- helpers

-- The active reads she has joined: the 10-read limit.
create or replace function private.buddy_active_count(p_member uuid)
returns integer
language sql
stable
set search_path = pg_catalog, public
as $$
  select count(*)::integer
    from public.buddy_read_members m
    join public.buddy_reads r on r.id = m.buddy_read_id
   where m.member_id = p_member and m.joined_at is not null and r.status = 'active'
$$;

-- Both joined one read (whatever its status: an ended room still lists its members), and neither
-- blocked the other. What lets co-members see each other's photo without a follow.
create or replace function private.buddy_co_members(p_a uuid, p_b uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select p_a is not null and p_b is not null and p_a <> p_b
     and exists (
       select 1
         from public.buddy_read_members x
         join public.buddy_read_members y on y.buddy_read_id = x.buddy_read_id
        where x.member_id = p_a and x.joined_at is not null
          and y.member_id = p_b and y.joined_at is not null
     )
     and not private.blocked_either(p_a, p_b)
$$;

-- The advisory locks, in the order of the header: a member's first, then a read's.
create or replace function private.buddy_lock_member(p_member uuid)
returns void
language sql
set search_path = pg_catalog
as $$
  select pg_advisory_xact_lock(hashtextextended('buddy:' || p_member::text, 0))
$$;

create or replace function private.buddy_lock_read(p_read uuid)
returns void
language sql
set search_path = pg_catalog
as $$
  select pg_advisory_xact_lock(hashtextextended('buddy_read:' || p_read::text, 0))
$$;

-- The hourly limit of one kind of call: forget her calls older than an hour, refuse at the limit,
-- count this one. Under her member lock.
create or replace function private.buddy_rate(p_member uuid, p_kind text, p_limit integer)
returns void
language plpgsql
set search_path = pg_catalog, private
as $$
begin
  delete from private.buddy_calls
   where member_id = p_member and kind = p_kind and at < now() - interval '1 hour';
  if (select count(*) from private.buddy_calls
       where member_id = p_member and kind = p_kind and at > now() - interval '1 hour') >= p_limit then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  insert into private.buddy_calls (member_id, kind) values (p_member, p_kind);
end;
$$;

-- Where a member is, as the other members see it (plan part 5.5): `section k` (she is reading
-- Section k = read_through + 1), `end` (every part read), `not_set` (no copy linked, nothing set).
-- Only the Section, never what it was worked out from.
create or replace function private.buddy_where(p_member public.buddy_read_members, p_parts integer)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
    when p_member.entry_id is null and p_member.hand_through is null and p_member.auto_through is null
      then jsonb_build_object('kind', 'not_set')
    when p_member.read_through >= p_parts
      then jsonb_build_object('kind', 'end')
    else jsonb_build_object('kind', 'section', 'section', p_member.read_through + 1)
  end
$$;

-- A member's card in a read: name, photo (when she may see it), role, where she is. Between two
-- members of whom one blocked the other, `where` is null, both ways (and the photo is not shown).
create or replace function private.buddy_card(p_caller uuid, p_member public.buddy_read_members, p_parts integer)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select private.member_card(p_caller, p_member.member_id)
         || jsonb_build_object(
              'role', p_member.role,
              'where', case when p_member.member_id <> p_caller and private.blocked_either(p_caller, p_member.member_id)
                            then null
                            else private.buddy_where(p_member, p_parts) end)
$$;

-- The client's list of Sections, checked: a JSON array of objects
-- { kind: 'part' | 'end', label: 1..120 characters, something visible, no control characters,
--   start_page, end_page: whole numbers or both
-- null, to_fraction: (0, 1], four places at most }, 1..100 parts in order of strictly increasing
-- to_fraction, page ranges contiguous where given, then exactly one end Section with to_fraction = 1, last. 'pages' needs a
-- page count and pages on every part. Answers the rows to insert, numbered from 1; refuses anything
-- else as buddy_sections_invalid.
create or replace function private.buddy_sections_parse(p_sections jsonb, p_from text, p_page_count integer)
returns table (s_position smallint, s_kind text, s_label text, s_start_page integer, s_end_page integer, s_to_fraction numeric)
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_n        integer;
  v_e        jsonb;
  v_kind     text;
  v_label    text;
  v_start    integer;
  v_end      integer;
  v_frac     numeric;
  v_prev     numeric := 0;
  v_prev_end integer;
begin
  if p_from is null or p_from not in ('count', 'pages', 'list')
     or (p_page_count is not null and p_page_count not between 1 and 99999)
     or (p_from = 'pages' and p_page_count is null)
     or p_sections is null or jsonb_typeof(p_sections) <> 'array' then
    raise exception 'buddy_sections_invalid' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_sections);
  if v_n < 2 or v_n > 101 then
    raise exception 'buddy_sections_invalid' using errcode = '22023';
  end if;

  for v_i in 0 .. v_n - 1 loop
    v_e := p_sections -> v_i;
    if jsonb_typeof(v_e) <> 'object'
       or jsonb_typeof(v_e -> 'kind') is distinct from 'string'
       or jsonb_typeof(v_e -> 'label') is distinct from 'string'
       or jsonb_typeof(v_e -> 'to_fraction') is distinct from 'number'
       or coalesce(jsonb_typeof(v_e -> 'start_page'), 'null') not in ('null', 'number')
       or coalesce(jsonb_typeof(v_e -> 'end_page'), 'null') not in ('null', 'number') then
      raise exception 'buddy_sections_invalid' using errcode = '22023';
    end if;
    v_kind := v_e ->> 'kind';
    v_label := btrim(v_e ->> 'label');
    v_frac := (v_e ->> 'to_fraction')::numeric;
    begin
      v_start := (v_e ->> 'start_page')::integer;
      v_end := (v_e ->> 'end_page')::integer;
    exception when others then
      raise exception 'buddy_sections_invalid' using errcode = '22023';
    end;
    if (v_e ->> 'start_page') is not null and (v_e ->> 'start_page')::numeric <> v_start
       or (v_e ->> 'end_page') is not null and (v_e ->> 'end_page')::numeric <> v_end then
      raise exception 'buddy_sections_invalid' using errcode = '22023';
    end if;

    -- The label, the fraction (to four places, as stored) and the pages of any Section.
    if char_length(v_label) not between 1 and 120
       or v_label ~ '[[:cntrl:]]' or v_label !~ '[^[:space:][:cntrl:]\u00a0\u200b]'
       or v_frac <> round(v_frac, 4) or v_frac <= 0 or v_frac > 1
       or (v_start is null) <> (v_end is null)
       or (v_start is not null and (v_start < 1 or v_end < v_start or v_end > 99999
                                    or (p_page_count is not null and v_end > p_page_count))) then
      raise exception 'buddy_sections_invalid' using errcode = '22023';
    end if;

    if v_i < v_n - 1 then
      -- A part: pages follow on from the part before, and every part has them when cut by pages.
      if v_kind <> 'part' or v_frac <= v_prev
         or (p_from = 'pages' and v_start is null)
         or (v_start is not null and v_prev_end is not null and v_start <> v_prev_end + 1) then
        raise exception 'buddy_sections_invalid' using errcode = '22023';
      end if;
      v_prev := v_frac;
      v_prev_end := v_end;
    elsif v_kind <> 'end' or v_frac <> 1 then
      -- The last: the one end Section, the whole Book.
      raise exception 'buddy_sections_invalid' using errcode = '22023';
    end if;

    s_position := (v_i + 1)::smallint;
    s_kind := v_kind;
    s_label := v_label;
    s_start_page := v_start;
    s_end_page := v_end;
    s_to_fraction := v_frac;
    return next;
  end loop;
end;
$$;

-- Invite these members to a read, as its host (the caller has the read's lock): only people she
-- follows (accepted) and nobody blocked either way with her or with any other member of the read.
-- The others are skipped, not refused. An invitation clears a removal (private.buddy_read_removed). The cap of 12 counts waiting invitations: a list that would
-- pass it is refused whole. Answers { invited: everyone in the list who is in the read now (joined or
-- invited), skipped: the rest }.
create or replace function private.buddy_invite(p_read uuid, p_host uuid, p_members uuid[])
returns jsonb
language plpgsql
set search_path = pg_catalog, public, private
as $$
declare
  v_new     uuid[];
  v_skipped uuid[];
  v_in      uuid[];
  v_rows    integer;
begin
  -- At most 11 can ever join her: a longer list is full before it is read.
  if cardinality(p_members) > 12 then
    raise exception 'buddy_read_full' using errcode = 'PT409';
  end if;
  with asked as (
    select distinct m as member_id from unnest(coalesce(p_members, '{}')) m where m is not null
  ), sorted as (
    select a.member_id,
           exists (select 1 from public.buddy_read_members x
                    where x.buddy_read_id = p_read and x.member_id = a.member_id) as present,
           a.member_id <> p_host
             and exists (select 1 from public.follows f
                          where f.follower_id = p_host and f.followee_id = a.member_id and f.accepted_at is not null)
             and not exists (select 1 from public.buddy_read_members x
                              where x.buddy_read_id = p_read and x.member_id <> a.member_id
                                and private.blocked_either(x.member_id, a.member_id)) as eligible
      from asked a
  )
  select coalesce(array_agg(member_id order by member_id) filter (where not present and eligible), '{}'),
         coalesce(array_agg(member_id order by member_id) filter (where not present and not eligible), '{}'),
         coalesce(array_agg(member_id order by member_id) filter (where present), '{}')
    into v_new, v_skipped, v_in
    from sorted;

  if cardinality(v_new) > 0 then
    select count(*) into v_rows from public.buddy_read_members where buddy_read_id = p_read;
    if v_rows + cardinality(v_new) > 12 then
      raise exception 'buddy_read_full' using errcode = 'PT409';
    end if;
    insert into public.buddy_read_members (buddy_read_id, member_id, role, invited_by)
    select p_read, m, 'member', p_host from unnest(v_new) m;
    -- Invited again by the host: a removal no longer keeps her out.
    delete from private.buddy_read_removed where buddy_read_id = p_read and member_id = any (v_new);
  end if;

  return jsonb_build_object(
    'invited', to_jsonb((select coalesce(array_agg(m order by m), '{}') from unnest(v_in || v_new) m)),
    'skipped', to_jsonb(v_skipped)
  );
end;
$$;

-- A joined member's own row in a read, or not_found: the gate of every function on one read.
create or replace function private.buddy_gate(p_read uuid, p_member uuid)
returns public.buddy_read_members
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_row public.buddy_read_members;
begin
  select * into v_row from public.buddy_read_members
   where buddy_read_id = p_read and member_id = p_member and joined_at is not null;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  return v_row;
end;
$$;

-- The same, for the host: a member who is not the host is refused as not_host.
create or replace function private.buddy_host_gate(p_read uuid, p_member uuid)
returns public.buddy_reads
language plpgsql
stable
set search_path = pg_catalog, public, private
as $$
declare
  v_read public.buddy_reads;
begin
  if (private.buddy_gate(p_read, p_member)).role <> 'host' then
    raise exception 'not_host' using errcode = 'PT403';
  end if;
  select * into v_read from public.buddy_reads where id = p_read;
  return v_read;
end;
$$;

-- Her own place in a read, for her alone: the numbers behind her Section and the copy it follows.
create or replace function private.buddy_me(p_member public.buddy_read_members, p_parts integer)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'entry_id', p_member.entry_id,
    'auto', p_member.auto_through,
    'hand', p_member.hand_through,
    'read_through', p_member.read_through,
    'where', private.buddy_where(p_member, p_parts)
  )
$$;

-- The number of parts of a read (its Sections but the end).
create or replace function private.buddy_parts(p_read uuid)
returns integer
language sql
stable
set search_path = pg_catalog, public
as $$
  select count(*)::integer from public.buddy_read_sections where buddy_read_id = p_read and kind = 'part'
$$;

-- ------------------------------------------------------------- the trigger: a member gone

-- After a member row is deleted (she left, was removed, declined, or her account went): when it was
-- the host's, the earliest-joined member left becomes host; when no joined member is left, the read
-- is deleted (its invitations and Sections with it). When the new host already hosts another active
-- read of the same Book, she is host by her row and host_id stays null (the one-active rule is kept).
create or replace function private.buddy_member_gone()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_read public.buddy_reads;
  v_next public.buddy_read_members;
begin
  perform private.buddy_lock_read(old.buddy_read_id);
  select * into v_read from public.buddy_reads where id = old.buddy_read_id;
  if not found then
    return null;  -- the read itself is going
  end if;

  select * into v_next from public.buddy_read_members
   where buddy_read_id = old.buddy_read_id and joined_at is not null
   order by (role = 'host') desc, joined_at, member_id
   limit 1;
  if not found then
    delete from public.buddy_reads where id = old.buddy_read_id;
    return null;
  end if;

  if v_next.role <> 'host' then
    update public.buddy_read_members set role = 'host'
     where buddy_read_id = old.buddy_read_id and member_id = v_next.member_id;
    -- host_id follows her, unless that breaks one active read per host and Book (or, for a read
    -- of hers made at the same moment, its unique index): then it stays null. Never an error here,
    -- or a leave or an account deletion would fail.
    begin
      update public.buddy_reads
         set host_id = case
               when status = 'active' and exists (
                      select 1 from public.buddy_reads o
                        join public.buddy_read_members h
                          on h.buddy_read_id = o.id and h.member_id = v_next.member_id and h.role = 'host'
                       where o.book_id = v_read.book_id and o.status = 'active' and o.id <> v_read.id)
               then null
               else v_next.member_id
             end
       where id = old.buddy_read_id;
    exception when unique_violation then
      update public.buddy_reads set host_id = null where id = old.buddy_read_id;
    end;
  end if;
  return null;
end;
$$;

create trigger buddy_read_members_gone
  after delete on public.buddy_read_members
  for each row execute function private.buddy_member_gone();

-- ------------------------------------------------------------- photos: co-members

-- As before, and the members of one read (both joined, no block) see each other's photo.
create or replace function private.can_see_photo(p_caller uuid, p_owner uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select p_caller is not null and p_owner is not null
     and (p_caller = p_owner
          or private.reachable(p_caller, p_owner)
          or private.buddy_co_members(p_caller, p_owner))
$$;

-- ------------------------------------------------------------- account deletion

-- As 20261009120000_avatars.sql left it, and first the locks of her buddy reads (the header's lock
-- order). create or replace keeps its grants.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_read   uuid;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  if exists (select 1 from storage.objects
              where bucket_id = 'avatars' and (storage.foldername(name))[1] = v_member::text) then
    raise exception 'photo_remains' using errcode = '55000';
  end if;

  -- Buddy reads: the lock of every read she is in, in one order, before any row of hers is deleted, so
  -- the host handover of private.buddy_member_gone never waits behind a lock this deletion holds.
  for v_read in select buddy_read_id from public.buddy_read_members where member_id = v_member order by buddy_read_id loop
    perform private.buddy_lock_read(v_read);
  end loop;

  delete from public.library_entries where member_id = v_member;
  delete from auth.users where id = v_member;
end;
$$;

-- ------------------------------------------------------------------------- the RPCs

-- Start a buddy read of a Catalogue Book she holds in her Library; her member row links that entry.
-- Sections as private.buddy_sections_parse takes them. Optionally invites people (as
-- invite_to_buddy_read, without counting as an invite call) and turns the link on. Idempotent on
-- (her, p_client_id): the same call again answers the read it made. Answers
-- { id, link_token, invited, skipped }.
create or replace function public.create_buddy_read(
  p_book uuid,
  p_client_id uuid,
  p_sections jsonb,
  p_invite uuid[] default '{}',
  p_link boolean default false,
  p_starts date default null,
  p_from text default 'count',
  p_page_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller  uuid := auth.uid();
  v_read    public.buddy_reads;
  v_book    public.books;
  v_entry   uuid;
  v_invites jsonb := jsonb_build_object('invited', '[]'::jsonb, 'skipped', '[]'::jsonb);
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'client_id_required' using errcode = '22023';
  end if;

  perform private.buddy_lock_member(v_caller);

  -- The same call again: the read it made, whatever became of it since.
  select * into v_read from public.buddy_reads where host_id = v_caller and client_id = p_client_id;
  if found then
    return jsonb_build_object('id', v_read.id, 'link_token', v_read.link_token,
                              'invited', '[]'::jsonb, 'skipped', '[]'::jsonb);
  end if;

  select * into v_book from public.books where id = p_book;
  select e.id into v_entry from public.library_entries e where e.member_id = v_caller and e.book_id = p_book;
  if v_book.id is null or v_book.owner_id is not null or v_book.source = 'manual' or v_book.check_failed
     or v_entry is null then
    raise exception 'buddy_book_invalid' using errcode = '22023';
  end if;
  if p_starts is not null and p_starts not between current_date - 366 and current_date + 366 then
    raise exception 'buddy_starts_invalid' using errcode = '22023';
  end if;
  perform 1 from private.buddy_sections_parse(p_sections, coalesce(p_from, 'count'), p_page_count);

  select r.* into v_read
    from public.buddy_reads r
    join public.buddy_read_members h on h.buddy_read_id = r.id and h.member_id = v_caller and h.role = 'host'
   where r.book_id = p_book and r.status = 'active';
  if found then
    raise exception 'buddy_read_exists' using errcode = 'PT409', detail = v_read.id::text;
  end if;

  perform private.buddy_rate(v_caller, 'create', 20);
  if private.buddy_active_count(v_caller) >= 10 then
    raise exception 'buddy_read_limit' using errcode = 'PT429';
  end if;

  insert into public.buddy_reads (book_id, host_id, starts_on, link_token, sections_from, page_count, client_id)
  values (p_book, v_caller, coalesce(p_starts, current_date),
          case when coalesce(p_link, false) then private.reading_page_token() end,
          coalesce(p_from, 'count'), p_page_count, p_client_id)
  returning * into v_read;

  insert into public.buddy_read_members (buddy_read_id, member_id, role, joined_at, entry_id)
  values (v_read.id, v_caller, 'host', clock_timestamp(), v_entry);

  insert into public.buddy_read_sections (buddy_read_id, position, kind, label, start_page, end_page, to_fraction)
  select v_read.id, s.s_position, s.s_kind, s.s_label, s.s_start_page, s.s_end_page, s.s_to_fraction
    from private.buddy_sections_parse(p_sections, coalesce(p_from, 'count'), p_page_count) s;

  if cardinality(coalesce(p_invite, '{}')) > 0 then
    perform private.buddy_lock_read(v_read.id);
    v_invites := private.buddy_invite(v_read.id, v_caller, p_invite);
  end if;

  return jsonb_build_object('id', v_read.id, 'link_token', v_read.link_token)
         || jsonb_build_object('invited', v_invites -> 'invited', 'skipped', v_invites -> 'skipped');
end;
$$;

-- Her reads and her waiting invitations. A read: its Book, status, her role, how many joined, her
-- own Section (`where`), unread (0 until D3). Every active read of hers and the 20 that ended last;
-- active first, then by start, newest first. An invitation: the Book, the host, who invited her, how
-- many joined; one that a block with any member of the read would refuse is left out; the 50 newest.
create or replace function public.my_buddy_reads()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'reads', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'book', private.social_book_json(b),
               'status', r.status,
               'starts_on', r.starts_on,
               'role', m.role,
               'member_count', (select count(*) from public.buddy_read_members x
                                 where x.buddy_read_id = r.id and x.joined_at is not null),
               'sections', private.buddy_parts(r.id),
               'where', private.buddy_where(m, private.buddy_parts(r.id)),
               'unread', 0
             ) order by (r.status = 'active') desc, r.starts_on desc, r.created_at desc, r.id)
        from public.buddy_read_members m
        join public.buddy_reads r on r.id = m.buddy_read_id
        join public.books b on b.id = r.book_id
       where m.member_id = v_caller and m.joined_at is not null
         and (r.status = 'active'
              or r.id in (select e.id
                            from public.buddy_read_members em
                            join public.buddy_reads e on e.id = em.buddy_read_id
                           where em.member_id = v_caller and em.joined_at is not null and e.status <> 'active'
                           order by coalesce(e.archived_at, e.finished_at) desc nulls last, e.id
                           limit 20))
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'book', private.social_book_json(b),
               'starts_on', r.starts_on,
               'host', (select private.member_card(v_caller, h.member_id) from public.buddy_read_members h
                         where h.buddy_read_id = r.id and h.role = 'host'),
               'invited_by', case when m.invited_by is not null then private.member_card(v_caller, m.invited_by) end,
               'member_count', (select count(*) from public.buddy_read_members x
                                 where x.buddy_read_id = r.id and x.joined_at is not null),
               'sections', private.buddy_parts(r.id)
             ) order by m.invited_at desc, r.id)
        from (select m0.*
                from public.buddy_read_members m0
                join public.buddy_reads r0 on r0.id = m0.buddy_read_id
               where m0.member_id = v_caller and m0.joined_at is null and r0.status = 'active'
                 and not exists (select 1 from public.buddy_read_members x
                                  where x.buddy_read_id = r0.id and x.member_id <> v_caller
                                    and private.blocked_either(x.member_id, v_caller))
               order by m0.invited_at desc, r0.id
               limit 50) m
        join public.buddy_reads r on r.id = m.buddy_read_id
        join public.books b on b.id = r.book_id
    ), '[]'::jsonb)
  );
end;
$$;

-- One read, for a joined member: the screen. Its Book, status, her role and whether she manages
-- it, the Sections, the joined members with their role and `where` (a Section, never a number), her
-- own place (`me`), and for the host the link and the waiting invitations.
create or replace function public.buddy_read(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_me     public.buddy_read_members;
  v_read   public.buddy_reads;
  v_parts  integer;
  v_host   boolean;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  v_me := private.buddy_gate(p_id, v_caller);
  select * into v_read from public.buddy_reads where id = p_id;
  v_parts := private.buddy_parts(p_id);
  v_host := v_me.role = 'host';

  return jsonb_build_object(
    'id', v_read.id,
    'book', (select private.social_book_json(b) from public.books b where b.id = v_read.book_id),
    'status', v_read.status,
    'starts_on', v_read.starts_on,
    'finished_at', v_read.finished_at,
    'archived_at', v_read.archived_at,
    'sections_from', v_read.sections_from,
    'page_count', v_read.page_count,
    'role', v_me.role,
    'can_manage', v_host,
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'position', s.position, 'kind', s.kind, 'label', s.label,
               'start_page', s.start_page, 'end_page', s.end_page, 'to_fraction', s.to_fraction,
               'count', 0, 'unread', 0
             ) order by s.position)
        from public.buddy_read_sections s where s.buddy_read_id = p_id
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(private.buddy_card(v_caller, m, v_parts)
                       order by (m.role = 'host') desc, m.joined_at, m.member_id)
        from public.buddy_read_members m
       where m.buddy_read_id = p_id and m.joined_at is not null
    ), '[]'::jsonb),
    'me', private.buddy_me(v_me, v_parts),
    'link_token', case when v_host then v_read.link_token end,
    'invited', case when v_host then coalesce((
      select jsonb_agg(private.member_card(v_caller, m.member_id) order by m.invited_at, m.member_id)
        from public.buddy_read_members m
       where m.buddy_read_id = p_id and m.joined_at is null
    ), '[]'::jsonb) end
  );
end;
$$;

-- The host invites members (private.buddy_invite has the rules). Answers { invited, skipped }.
create or replace function public.invite_to_buddy_read(p_id uuid, p_members uuid[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_read   public.buddy_reads;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_host_gate(p_id, v_caller);

  perform private.buddy_lock_member(v_caller);
  perform private.buddy_lock_read(p_id);
  v_read := private.buddy_host_gate(p_id, v_caller);
  if v_read.status <> 'active' then
    raise exception 'buddy_read_ended' using errcode = 'PT409';
  end if;
  perform private.buddy_rate(v_caller, 'invite', 20);
  return private.buddy_invite(p_id, v_caller, p_members);
end;
$$;

-- The host turns the link on (a token if there is none, a new one with p_renew: the old one dies)
-- or off (the token is forgotten). Answers the token, or null when off.
create or replace function public.buddy_read_link(p_id uuid, p_on boolean, p_renew boolean default false)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_read   public.buddy_reads;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_host_gate(p_id, v_caller);
  perform private.buddy_lock_read(p_id);
  v_read := private.buddy_host_gate(p_id, v_caller);

  if not coalesce(p_on, false) then
    update public.buddy_reads set link_token = null where id = p_id;
    return null;
  end if;
  if v_read.status <> 'active' then
    raise exception 'buddy_read_ended' using errcode = 'PT409';
  end if;
  if v_read.link_token is null or coalesce(p_renew, false) then
    update public.buddy_reads set link_token = private.reading_page_token() where id = p_id
    returning link_token into v_read.link_token;
  end if;
  return v_read.link_token;
end;
$$;

-- The read behind a link, for the join card: its Book, the host, the joined members' cards, how many,
-- the number of parts, the start day, and where the caller stands ('none', 'invited', 'member').
-- Null, the one answer for all of them, for a malformed or unknown token (wrong, off or renewed), a
-- read that ended, a read that is full (to a caller with no place in it), a caller who blocked or was
-- blocked by any member of it, and a member the host removed: nothing tells which. Anyone holding the
-- link sees the names of its members (and their photos only as can_see_photo allows), private
-- accounts included: a link shared is a room opened, as the privacy text says.
create or replace function public.buddy_read_target(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_read   public.buddy_reads;
  v_mine   public.buddy_read_members;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    return null;
  end if;

  select * into v_read from public.buddy_reads where link_token = p_token;
  if not found or v_read.status <> 'active'
     or exists (select 1 from public.buddy_read_members x
                 where x.buddy_read_id = v_read.id and x.member_id <> v_caller
                   and private.blocked_either(x.member_id, v_caller))
     or exists (select 1 from private.buddy_read_removed d
                 where d.buddy_read_id = v_read.id and d.member_id = v_caller) then
    return null;
  end if;
  select * into v_mine from public.buddy_read_members where buddy_read_id = v_read.id and member_id = v_caller;
  if v_mine.member_id is null
     and (select count(*) from public.buddy_read_members where buddy_read_id = v_read.id) >= 12 then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_read.id,
    'book', (select private.social_book_json(b) from public.books b where b.id = v_read.book_id),
    'host', (select private.member_card(v_caller, h.member_id) from public.buddy_read_members h
              where h.buddy_read_id = v_read.id and h.role = 'host'),
    'members', coalesce((
      select jsonb_agg(private.member_card(v_caller, m.member_id) order by (m.role = 'host') desc, m.joined_at, m.member_id)
        from public.buddy_read_members m
       where m.buddy_read_id = v_read.id and m.joined_at is not null
    ), '[]'::jsonb),
    'member_count', (select count(*) from public.buddy_read_members m
                      where m.buddy_read_id = v_read.id and m.joined_at is not null),
    'sections', private.buddy_parts(v_read.id),
    'starts_on', v_read.starts_on,
    'state', case when v_mine.member_id is null then 'none'
                  when v_mine.joined_at is null then 'invited'
                  else 'member' end
  );
end;
$$;

-- Join by link. Idempotent (a member already in answers the read and counts no call); a waiting
-- invitation becomes her membership. Refused as not_found for everything buddy_read_target answers
-- null to (a removed member too, until the host invites her again) except a full read, which is
-- buddy_read_full; rate_limited (30 an hour), buddy_read_limit.
-- Answers { id }.
create or replace function public.join_buddy_read(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_read   public.buddy_reads;
  v_mine   public.buddy_read_members;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  perform private.buddy_lock_member(v_caller);
  select * into v_read from public.buddy_reads where link_token = p_token;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  perform private.buddy_lock_read(v_read.id);

  -- Everything again under the read's lock: the token, the status, her row, a block.
  select * into v_read from public.buddy_reads where id = v_read.id and link_token = p_token;
  if not found or v_read.status <> 'active' then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  select * into v_mine from public.buddy_read_members where buddy_read_id = v_read.id and member_id = v_caller;
  if v_mine.joined_at is not null then
    return jsonb_build_object('id', v_read.id);
  end if;
  if exists (select 1 from public.buddy_read_members x
              where x.buddy_read_id = v_read.id and x.member_id <> v_caller
                and private.blocked_either(x.member_id, v_caller))
     or exists (select 1 from private.buddy_read_removed d
                 where d.buddy_read_id = v_read.id and d.member_id = v_caller) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  perform private.buddy_rate(v_caller, 'join', 30);
  if private.buddy_active_count(v_caller) >= 10 then
    raise exception 'buddy_read_limit' using errcode = 'PT429';
  end if;

  if v_mine.member_id is not null then
    update public.buddy_read_members set joined_at = clock_timestamp()
     where buddy_read_id = v_read.id and member_id = v_caller;
  else
    if (select count(*) from public.buddy_read_members where buddy_read_id = v_read.id) >= 12 then
      raise exception 'buddy_read_full' using errcode = 'PT409';
    end if;
    insert into public.buddy_read_members (buddy_read_id, member_id, role, joined_at)
    values (v_read.id, v_caller, 'member', clock_timestamp());
  end if;
  return jsonb_build_object('id', v_read.id);
end;
$$;

-- Accept or decline her waiting invitation. Accepting needs the read active and no block with any
-- other member (else not_found, as for no invitation), and her 10-read limit (buddy_read_limit).
-- Declining deletes the invitation. Either way, an invitation that is not there is not_found.
create or replace function public.answer_buddy_invite(p_id uuid, p_join boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_join is null then
    raise exception 'buddy_answer_invalid' using errcode = '22023';
  end if;

  if not exists (select 1 from public.buddy_read_members
                  where buddy_read_id = p_id and member_id = v_caller and joined_at is null) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if p_join then
    perform private.buddy_lock_member(v_caller);
  end if;
  perform private.buddy_lock_read(p_id);
  if not exists (select 1 from public.buddy_read_members
                  where buddy_read_id = p_id and member_id = v_caller and joined_at is null) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  if not p_join then
    delete from public.buddy_read_members where buddy_read_id = p_id and member_id = v_caller;
    return;
  end if;

  if not exists (select 1 from public.buddy_reads where id = p_id and status = 'active')
     or exists (select 1 from public.buddy_read_members x
                 where x.buddy_read_id = p_id and x.member_id <> v_caller
                   and private.blocked_either(x.member_id, v_caller)) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if private.buddy_active_count(v_caller) >= 10 then
    raise exception 'buddy_read_limit' using errcode = 'PT429';
  end if;
  update public.buddy_read_members set joined_at = clock_timestamp()
   where buddy_read_id = p_id and member_id = v_caller;
end;
$$;

-- She leaves: her member row goes, and with it her Section from every member's view at once. The host
-- role passes to the earliest-joined member; the last one out deletes the read (the trigger).
-- p_delete_messages deletes her messages too once there are messages (D3); nothing yet.
create or replace function public.leave_buddy_read(p_id uuid, p_delete_messages boolean default false)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_gate(p_id, v_caller);
  perform private.buddy_lock_read(p_id);
  perform private.buddy_gate(p_id, v_caller);
  delete from public.buddy_read_members where buddy_read_id = p_id and member_id = v_caller;
end;
$$;

-- The host removes a member, or withdraws an invitation. Someone not in the read: nothing to do.
-- Either way she stays out: the link does not let her back in until the host invites her again.
create or replace function public.remove_from_buddy_read(p_id uuid, p_member uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_host_gate(p_id, v_caller);
  if p_member is not distinct from v_caller then
    raise exception 'buddy_remove_self' using errcode = '22023';
  end if;
  perform private.buddy_lock_read(p_id);
  perform private.buddy_host_gate(p_id, v_caller);
  delete from public.buddy_read_members where buddy_read_id = p_id and member_id = p_member;
  if found then
    insert into private.buddy_read_removed (buddy_read_id, member_id) values (p_id, p_member)
    on conflict (buddy_read_id, member_id) do update set removed_at = clock_timestamp();
  end if;
end;
$$;

-- The host finishes the read: it takes nobody new (link and invitations stop working), its threads
-- stay open. Again: nothing changes.
create or replace function public.finish_buddy_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_read   public.buddy_reads;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_host_gate(p_id, v_caller);
  perform private.buddy_lock_read(p_id);
  v_read := private.buddy_host_gate(p_id, v_caller);
  if v_read.status = 'archived' then
    raise exception 'buddy_read_archived' using errcode = 'PT409';
  end if;
  update public.buddy_reads set status = 'finished', finished_at = clock_timestamp()
   where id = p_id and status = 'active';
end;
$$;

-- The host archives the read: read only from now on (D3: no new message). Again: nothing changes.
create or replace function public.archive_buddy_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_host_gate(p_id, v_caller);
  perform private.buddy_lock_read(p_id);
  perform private.buddy_host_gate(p_id, v_caller);
  update public.buddy_reads
     set status = 'archived', archived_at = clock_timestamp(),
         finished_at = coalesce(finished_at, clock_timestamp())
   where id = p_id and status <> 'archived';
end;
$$;

-- The host changes the Sections. The same division (as many Sections, each of the same kind and
-- ending at the same fraction) is a rename: labels and pages change, the Sections keep their ids.
-- Another division replaces them (D3 refuses that as buddy_sections_locked once a Section thread
-- has a message) and every member's hand-set Section is held to the new number of parts.
-- Answers the read as buddy_read does.
create or replace function public.set_buddy_sections(
  p_id uuid,
  p_sections jsonb,
  p_from text default 'count',
  p_page_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_read   public.buddy_reads;
  v_new    jsonb;
  v_same   boolean;
  v_parts  integer;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_host_gate(p_id, v_caller);
  perform private.buddy_lock_read(p_id);
  v_read := private.buddy_host_gate(p_id, v_caller);
  if v_read.status = 'archived' then
    raise exception 'buddy_read_archived' using errcode = 'PT409';
  end if;

  select jsonb_agg(to_jsonb(s) order by s.s_position) into v_new
    from private.buddy_sections_parse(p_sections, coalesce(p_from, 'count'), p_page_count) s;

  with n as (
    select * from jsonb_to_recordset(v_new)
      as x(s_position smallint, s_kind text, s_label text, s_start_page integer, s_end_page integer, s_to_fraction numeric)
  )
  select (select count(*) from n) = (select count(*) from public.buddy_read_sections where buddy_read_id = p_id)
     and not exists (
       select 1 from n
         left join public.buddy_read_sections s
           on s.buddy_read_id = p_id and s.position = n.s_position and s.kind = n.s_kind and s.to_fraction = n.s_to_fraction
        where s.id is null)
    into v_same;

  if v_same then
    update public.buddy_read_sections s
       set label = n.s_label, start_page = n.s_start_page, end_page = n.s_end_page
      from jsonb_to_recordset(v_new)
        as n(s_position smallint, s_kind text, s_label text, s_start_page integer, s_end_page integer, s_to_fraction numeric)
     where s.buddy_read_id = p_id and s.position = n.s_position;
  else
    delete from public.buddy_read_sections where buddy_read_id = p_id;
    insert into public.buddy_read_sections (buddy_read_id, position, kind, label, start_page, end_page, to_fraction)
    select p_id, n.s_position, n.s_kind, n.s_label, n.s_start_page, n.s_end_page, n.s_to_fraction
      from jsonb_to_recordset(v_new)
        as n(s_position smallint, s_kind text, s_label text, s_start_page integer, s_end_page integer, s_to_fraction numeric);
    v_parts := private.buddy_parts(p_id);
    update public.buddy_read_members set hand_through = v_parts
     where buddy_read_id = p_id and hand_through > v_parts;
  end if;

  update public.buddy_reads set sections_from = coalesce(p_from, 'count'), page_count = p_page_count where id = p_id;
  return public.buddy_read(p_id);
end;
$$;

-- Link her copy: an entry of her Library of the read's Book, or of another edition of the same
-- work (the same Open Library work key, neither failed its check), as book_readers decides who read
-- a Book. Null unlinks. Answers her own place, as `me` in buddy_read.
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

-- Her hand override: the number of parts she says she has read, 0 to all of them; null clears it.
-- Her Section is the greater of it and the one her progress gives (D2). Answers her own place.
create or replace function public.set_buddy_hand(p_id uuid, p_through integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_me     public.buddy_read_members;
  v_parts  integer;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_gate(p_id, v_caller);
  perform private.buddy_lock_read(p_id);
  perform private.buddy_gate(p_id, v_caller);
  if (select status from public.buddy_reads where id = p_id) = 'archived' then
    raise exception 'buddy_read_archived' using errcode = 'PT409';
  end if;
  v_parts := private.buddy_parts(p_id);
  if p_through is not null and (p_through < 0 or p_through > v_parts) then
    raise exception 'buddy_position_invalid' using errcode = '22023';
  end if;

  update public.buddy_read_members set hand_through = p_through
   where buddy_read_id = p_id and member_id = v_caller
  returning * into v_me;
  return private.buddy_me(v_me, v_parts);
end;
$$;

-- ------------------------------------------------------------------------- grants

-- The helpers are for the functions above only.
revoke all on function private.buddy_active_count(uuid) from public, anon, authenticated;
revoke all on function private.buddy_co_members(uuid, uuid) from public, anon, authenticated;
revoke all on function private.buddy_lock_member(uuid) from public, anon, authenticated;
revoke all on function private.buddy_lock_read(uuid) from public, anon, authenticated;
revoke all on function private.buddy_rate(uuid, text, integer) from public, anon, authenticated;
revoke all on function private.buddy_where(public.buddy_read_members, integer) from public, anon, authenticated;
revoke all on function private.buddy_card(uuid, public.buddy_read_members, integer) from public, anon, authenticated;
revoke all on function private.buddy_sections_parse(jsonb, text, integer) from public, anon, authenticated;
revoke all on function private.buddy_invite(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function private.buddy_gate(uuid, uuid) from public, anon, authenticated;
revoke all on function private.buddy_host_gate(uuid, uuid) from public, anon, authenticated;
revoke all on function private.buddy_me(public.buddy_read_members, integer) from public, anon, authenticated;
revoke all on function private.buddy_parts(uuid) from public, anon, authenticated;
revoke all on function private.buddy_member_gone() from public, anon, authenticated;

revoke all on function public.create_buddy_read(uuid, uuid, jsonb, uuid[], boolean, date, text, integer) from public, anon;
revoke all on function public.my_buddy_reads() from public, anon;
revoke all on function public.buddy_read(uuid) from public, anon;
revoke all on function public.invite_to_buddy_read(uuid, uuid[]) from public, anon;
revoke all on function public.buddy_read_link(uuid, boolean, boolean) from public, anon;
revoke all on function public.buddy_read_target(text) from public, anon;
revoke all on function public.join_buddy_read(text) from public, anon;
revoke all on function public.answer_buddy_invite(uuid, boolean) from public, anon;
revoke all on function public.leave_buddy_read(uuid, boolean) from public, anon;
revoke all on function public.remove_from_buddy_read(uuid, uuid) from public, anon;
revoke all on function public.finish_buddy_read(uuid) from public, anon;
revoke all on function public.archive_buddy_read(uuid) from public, anon;
revoke all on function public.set_buddy_sections(uuid, jsonb, text, integer) from public, anon;
revoke all on function public.link_buddy_entry(uuid, uuid) from public, anon;
revoke all on function public.set_buddy_hand(uuid, integer) from public, anon;
grant execute on function public.create_buddy_read(uuid, uuid, jsonb, uuid[], boolean, date, text, integer) to authenticated;
grant execute on function public.my_buddy_reads() to authenticated;
grant execute on function public.buddy_read(uuid) to authenticated;
grant execute on function public.invite_to_buddy_read(uuid, uuid[]) to authenticated;
grant execute on function public.buddy_read_link(uuid, boolean, boolean) to authenticated;
grant execute on function public.buddy_read_target(text) to authenticated;
grant execute on function public.join_buddy_read(text) to authenticated;
grant execute on function public.answer_buddy_invite(uuid, boolean) to authenticated;
grant execute on function public.leave_buddy_read(uuid, boolean) to authenticated;
grant execute on function public.remove_from_buddy_read(uuid, uuid) to authenticated;
grant execute on function public.finish_buddy_read(uuid) to authenticated;
grant execute on function public.archive_buddy_read(uuid) to authenticated;
grant execute on function public.set_buddy_sections(uuid, jsonb, text, integer) to authenticated;
grant execute on function public.link_buddy_entry(uuid, uuid) to authenticated;
grant execute on function public.set_buddy_hand(uuid, integer) to authenticated;
