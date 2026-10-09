-- Social version 1, D1 (docs/proposals/social-v1-contract.md §1.2, §1.4, §1.5): her own
-- settings, the tables of following and blocking, hiding a Book, and who may see a photo.
--
-- Libellus has been private by design: nobody sees a member's reading. Social v1 lets her
-- choose to be followed. This migration is the base the three that follow build on (D2
-- following, D3 activity, D4 reading what others read): it holds what is hers, and the
-- helpers every later function asks "may this member see that one?" through.
--
-- A member starts PRIVATE with every section on and no link. Her row in `social_settings` is
-- made when she first asks for her settings (`my_social()`) or changes one; a member without a
-- row counts as private with every section on (`private.social_of`), everywhere. Her follow
-- link is 22 characters of base64url (128 random bits, the token of the reading page): whoever
-- opens it (D2's `follow_target`) is recorded in `follow_link_views`, which is all that lets a
-- stranger reach a private account's card, photo and "Ask to follow". A new link replaces the
-- old one and forgets the visitors who only opened the old one.
--
-- Tables, all closed to the API roles (no grants) except `social_settings`, which her own row
-- may read (`follows`, `blocks` and `follow_link_views` are read only through functions, so
-- that the asker never sees `declined_at` and nobody learns who blocked whom):
--
--   social_settings      private, her seven switches, the follow link
--   follows              follower -> followee: accepted, a request, or a declined one
--   blocks               blocker -> blocked
--   follow_link_views    who opened whose follow link
--   library_entries.hidden   a Book she keeps from her followers
--   private.social_config    one row: the settle window of D3's activity (tests shorten it)
--   private.follow_calls     calls of D2's follow(), for the hourly limit
--
-- Helpers in `private` (revoked from every API role, for D2 to D4 to call):
--
--   social_of(member)            her settings, or the defaults when she has no row
--   blocked_either(a, b)         one blocked the other
--   reachable(caller, owner)     §1.4: not herself, not blocked either way, and public, or a
--                                follow or request either way, or the caller opened her link
--   visible(caller, owner)       §1.4: reachable, and public or followed (accepted)
--   can_see_photo(caller, owner) herself, or reachable
--   member_name(member)          the first name, trimmed, at most 40 characters, or null
--   member_card(caller, owner)   { id, name, photo }; photo only when she may see it
--   my_social_json(member)       { private, sections, link, requests }
--
-- Her side, all `security definer`, for the signed-in member only:
--
--   my_social()                    her settings (makes the row)
--   set_private(private)           going public accepts every waiting, undeclined request
--   set_social_sections(sections)  { "reading": false, … }; unnamed ones keep their value
--   renew_follow_link()            a new link; visitors who only opened the old one are forgotten
--   set_entry_hidden(entry, hidden)  also an action of `sync_write`
--   can_see_member_photo(owner)    herself, or reachable (in `public`: a Storage policy calls it)
--
-- Refusals: not_signed_in (42501), social_sections_invalid (22023: an unknown key or a value
-- that is not a boolean), entry_not_found (P0002: an entry that is not hers).
--
-- Deleted with the member: every row above cascades from auth.users.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- --------------------------------------------------------------------- tables

create table public.social_settings (
  member_id      uuid primary key references auth.users on delete cascade,
  private        boolean not null default true,
  show_reading   boolean not null default true,
  show_want      boolean not null default true,
  show_finished  boolean not null default true,
  show_ratings   boolean not null default true,
  show_reviews   boolean not null default true,
  show_abandoned boolean not null default true,
  show_year      boolean not null default true,
  -- The follow link's secret: private.reading_page_token(), 16 random bytes, base64url.
  follow_token   text not null unique check (follow_token ~ '^[A-Za-z0-9_-]{22}$'),
  updated_at     timestamptz not null default now()
);

comment on table public.social_settings is
  'Social v1: whether a member''s account is private, which sections of her reading others may see, '
  'and her follow link. No row = private, every section on, no link yet (private.social_of). '
  'Read by its member; written only through the functions in 20261015010000_social_settings.sql.';

create table public.follows (
  follower_id  uuid not null references auth.users on delete cascade,
  followee_id  uuid not null references auth.users on delete cascade,
  requested_at timestamptz not null default now(),
  accepted_at  timestamptz,          -- null: a request
  declined_at  timestamptz,          -- set: declined; the asker still sees "requested"
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id),
  check (accepted_at is null or declined_at is null)
);

create index follows_followee on public.follows (followee_id);

comment on table public.follows is
  'Social v1: follower -> followee, accepted, or a request that waits or was declined. Read only '
  'through functions (the asker must never see declined_at).';

create table public.blocks (
  blocker_id uuid not null references auth.users on delete cascade,
  blocked_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

comment on table public.blocks is
  'Social v1: a member blocked another. Read only through functions (the blocked must never learn of it).';

-- Who opened whose follow link (follow_target writes it): what lets a private account's
-- card, photo and "Ask to follow" reach a member at all.
create table public.follow_link_views (
  visitor_id uuid not null references auth.users on delete cascade,
  member_id  uuid not null references auth.users on delete cascade,
  viewed_at  timestamptz not null default now(),
  primary key (visitor_id, member_id)
);

comment on table public.follow_link_views is
  'Social v1: who opened whose follow link. Written by follow_target, forgotten by renew_follow_link and block.';

alter table public.library_entries add column hidden boolean not null default false;

comment on column public.library_entries.hidden is
  'Social v1: a Book she keeps from her followers (feed, profile, lists); never affects her own Library.';

-- One row: settings of the social machinery itself (tests shorten the window).
create table private.social_config (
  id            boolean primary key default true check (id),
  settle_window interval not null default interval '10 minutes'
);

insert into private.social_config default values;

-- Calls of follow(), for the hourly limit; rows older than a day are deleted by follow() itself.
create table private.follow_calls (
  member_id uuid not null references auth.users on delete cascade,
  at        timestamptz not null default now()
);

create index follow_calls_member_at on private.follow_calls (member_id, at);

-- ------------------------------------------------------------------------ RLS

alter table public.social_settings enable row level security;
alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.follow_link_views enable row level security;

-- Supabase grants every new public table to the API roles; these want the opposite.
revoke all on public.social_settings from anon, authenticated;
revoke all on public.follows from anon, authenticated;
revoke all on public.blocks from anon, authenticated;
revoke all on public.follow_link_views from anon, authenticated;
grant select on public.social_settings to authenticated;

create policy social_settings_select_own on public.social_settings
  for select to authenticated using (member_id = (select auth.uid()));

-- ------------------------------------------------------------------- helpers

-- Her settings, or the defaults (private, every section on, no link) when she has no row.
create or replace function private.social_of(p_member uuid)
returns public.social_settings
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_row public.social_settings;
begin
  select * into v_row from public.social_settings where member_id = p_member;
  if not found then
    v_row := row(p_member, true, true, true, true, true, true, true, true, null, now())::public.social_settings;
  end if;
  return v_row;
end;
$$;

-- Her row, made with a fresh link if she has none; the row.
create or replace function private.social_ensure(p_member uuid)
returns public.social_settings
language plpgsql
set search_path = pg_catalog, public, private
as $$
declare
  v_row public.social_settings;
begin
  insert into public.social_settings (member_id, follow_token)
  values (p_member, private.reading_page_token())
  on conflict (member_id) do nothing;
  select * into v_row from public.social_settings where member_id = p_member;
  return v_row;
end;
$$;

-- One of them blocked the other.
create or replace function private.blocked_either(p_a uuid, p_b uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.blocks
     where (blocker_id = p_a and blocked_id = p_b)
        or (blocker_id = p_b and blocked_id = p_a)
  )
$$;

-- Reachable: the owner is not the caller, neither blocked the other, and one of: her account is
-- public; the caller follows her or asked to (declined included); she follows the caller or
-- asked to; the caller opened her link.
create or replace function private.reachable(p_caller uuid, p_owner uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select p_caller is not null and p_owner is not null and p_caller <> p_owner
     and not private.blocked_either(p_caller, p_owner)
     and (
       not (private.social_of(p_owner)).private
       or exists (select 1 from public.follows
                   where (follower_id = p_caller and followee_id = p_owner)
                      or (follower_id = p_owner and followee_id = p_caller))
       or exists (select 1 from public.follow_link_views where visitor_id = p_caller and member_id = p_owner)
     )
$$;

-- Visible (her reading): reachable, and her account is public or the caller follows her
-- (accepted). A request that still waits sees nothing.
create or replace function private.visible(p_caller uuid, p_owner uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select private.reachable(p_caller, p_owner)
     and (
       not (private.social_of(p_owner)).private
       or exists (select 1 from public.follows
                   where follower_id = p_caller and followee_id = p_owner and accepted_at is not null)
     )
$$;

-- Her photo is for herself and for the members she is reachable by.
create or replace function private.can_see_photo(p_caller uuid, p_owner uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select p_caller is not null and p_owner is not null
     and (p_caller = p_owner or private.reachable(p_caller, p_owner))
$$;

-- Her first name, as the greeting keeps it (user_metadata.name): trimmed, at most 40
-- characters, null when empty.
create or replace function private.member_name(p_member uuid)
returns text
language sql
stable
set search_path = pg_catalog, auth
as $$
  select nullif(left(btrim(raw_user_meta_data ->> 'name'), 40), '') from auth.users where id = p_member
$$;

-- A member as others see her: { id, name, photo }. The photo's path only when the caller may
-- see it (never the address; a block hides it both ways).
create or replace function private.member_card(p_caller uuid, p_owner uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'id', p_owner,
    'name', private.member_name(p_owner),
    'photo', case when private.can_see_photo(p_caller, p_owner)
                  then (select a.avatar_path from public.accounts a where a.id = p_owner) end
  )
$$;

-- What she is shown of her own settings, shared by the setters.
create or replace function private.my_social_json(p_member uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'private', s.private,
    'sections', jsonb_build_object(
      'reading', s.show_reading, 'want', s.show_want, 'finished', s.show_finished,
      'ratings', s.show_ratings, 'reviews', s.show_reviews, 'abandoned', s.show_abandoned,
      'year', s.show_year),
    'link', s.follow_token,
    'requests', (select count(*) from public.follows f
                  where f.followee_id = p_member and f.accepted_at is null and f.declined_at is null)
  )
  from (select (private.social_of(p_member)).*) s
$$;

revoke all on function private.social_of(uuid) from public, anon, authenticated;
revoke all on function private.social_ensure(uuid) from public, anon, authenticated;
revoke all on function private.blocked_either(uuid, uuid) from public, anon, authenticated;
revoke all on function private.reachable(uuid, uuid) from public, anon, authenticated;
revoke all on function private.visible(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_see_photo(uuid, uuid) from public, anon, authenticated;
revoke all on function private.member_name(uuid) from public, anon, authenticated;
revoke all on function private.member_card(uuid, uuid) from public, anon, authenticated;
revoke all on function private.my_social_json(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ her side

-- Her settings; the row (with its link) is made here if she has none yet.
create or replace function public.my_social()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.social_ensure(v_member);
  return private.my_social_json(v_member);
end;
$$;

-- Private or public. Going public (false) accepts every request that waits and was not declined.
create or replace function public.set_private(p_private boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.social_ensure(v_member);
  update public.social_settings
     set private = coalesce(p_private, private), updated_at = now()
   where member_id = v_member;
  if p_private is false then
    update public.follows
       set accepted_at = now()
     where followee_id = v_member and accepted_at is null and declined_at is null;
  end if;
  return private.my_social_json(v_member);
end;
$$;

-- The sections, by name; the ones not named keep what they were.
create or replace function public.set_social_sections(p_sections jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_member uuid := auth.uid();
  v_key    text;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_sections is null or jsonb_typeof(p_sections) <> 'object' then
    raise exception 'social_sections_invalid' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_sections) loop
    if v_key not in ('reading', 'want', 'finished', 'ratings', 'reviews', 'abandoned', 'year')
       or jsonb_typeof(p_sections -> v_key) <> 'boolean' then
      raise exception 'social_sections_invalid' using errcode = '22023';
    end if;
  end loop;

  perform private.social_ensure(v_member);
  update public.social_settings
     set show_reading   = coalesce((p_sections ->> 'reading')::boolean, show_reading),
         show_want      = coalesce((p_sections ->> 'want')::boolean, show_want),
         show_finished  = coalesce((p_sections ->> 'finished')::boolean, show_finished),
         show_ratings   = coalesce((p_sections ->> 'ratings')::boolean, show_ratings),
         show_reviews   = coalesce((p_sections ->> 'reviews')::boolean, show_reviews),
         show_abandoned = coalesce((p_sections ->> 'abandoned')::boolean, show_abandoned),
         show_year      = coalesce((p_sections ->> 'year')::boolean, show_year),
         updated_at     = now()
   where member_id = v_member;
  return private.my_social_json(v_member);
end;
$$;

-- A new link; the old one is dead from now on. Visitors who only opened the old link (no follow
-- or request with her either way) are forgotten: they cannot reach her any more.
create or replace function public.renew_follow_link()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.social_ensure(v_member);
  update public.social_settings
     set follow_token = private.reading_page_token(), updated_at = now()
   where member_id = v_member;
  delete from public.follow_link_views v
   where v.member_id = v_member
     and not exists (
       select 1 from public.follows f
        where (f.follower_id = v.visitor_id and f.followee_id = v_member)
           or (f.follower_id = v_member and f.followee_id = v.visitor_id));
  return private.my_social_json(v_member);
end;
$$;

-- A Book kept from her followers (or shown again). Her own Library is unchanged.
create or replace function public.set_entry_hidden(p_entry uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  -- A null leaves the Book as it is: a missing value must never show what she hid.
  update public.library_entries
     set hidden = coalesce(p_hidden, hidden)
   where id = p_entry and member_id = v_member;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Whether the caller may see this member's photo: her own, or a member reachable for her
-- (§1.4). In `public` because a Storage policy cannot call into `private`.
create or replace function public.can_see_member_photo(p_owner uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  return private.can_see_photo(v_member, p_owner);
end;
$$;

revoke all on function public.my_social() from public, anon;
revoke all on function public.set_private(boolean) from public, anon;
revoke all on function public.set_social_sections(jsonb) from public, anon;
revoke all on function public.renew_follow_link() from public, anon;
revoke all on function public.set_entry_hidden(uuid, boolean) from public, anon;
revoke all on function public.can_see_member_photo(uuid) from public, anon;
grant execute on function public.my_social() to authenticated;
grant execute on function public.set_private(boolean) to authenticated;
grant execute on function public.set_social_sections(jsonb) to authenticated;
grant execute on function public.renew_follow_link() to authenticated;
grant execute on function public.set_entry_hidden(uuid, boolean) to authenticated;
grant execute on function public.can_see_member_photo(uuid) to authenticated;

-- ----------------------------------------------------------------- sync_write

-- The latest sync_write (20261010120000_reader_highlights.sql), taking `set_entry_hidden` as one
-- more write a device may queue; nothing else changed.
create or replace function public.sync_write(p_request_id uuid, p_action text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member  uuid := auth.uid();
  v_today   date := (now() at time zone 'utc')::date;
  v_args    jsonb := coalesce(p_args, '{}'::jsonb);
  v_result  jsonb := '{}'::jsonb;
  v_entry   public.library_entries;
  v_session public.reading_sessions;
  v_day     date;
  v_mine    uuid;
  v_first   uuid;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request_invalid' using errcode = '22023';
  end if;

  -- Claimed first: a second send of the same write waits here until the first
  -- commits (and then answers from it) or rolls back (and then applies it).
  insert into public.synced_writes (request_id, member_id, action)
  values (p_request_id, v_member, p_action)
  on conflict (request_id) do nothing;
  if not found then
    select member_id, result into v_mine, v_result from public.synced_writes where request_id = p_request_id;
    if v_mine is distinct from v_member then
      raise exception 'request_invalid' using errcode = '22023';
    end if;
    return jsonb_build_object('replayed', true) || v_result;
  end if;

  case p_action
    when 'add_to_library' then
      select * into v_entry from public.add_to_library(
        p_book       => v_args -> 'p_book',
        p_status     => coalesce((v_args ->> 'p_status')::public.entry_status, 'want_to_read'),
        p_started_on => (v_args ->> 'p_started_on')::date,
        p_ended_on   => (v_args ->> 'p_ended_on')::date,
        p_rating     => (v_args ->> 'p_rating')::integer,
        p_review     => v_args ->> 'p_review'
      );
      select s.id into v_first from public.latest_session(v_entry) s;
      v_result := jsonb_strip_nulls(jsonb_build_object('entry_id', v_entry.id, 'session_id', v_first));

    when 'start_reading' then
      select * into v_session from public.start_reading(
        p_entry_id   => (v_args ->> 'p_entry_id')::uuid,
        p_started_on => (v_args ->> 'p_started_on')::date
      );
      v_result := jsonb_build_object('entry_id', v_session.entry_id, 'session_id', v_session.id);

    when 'read_again' then
      select * into v_session from public.read_again(
        p_entry_id   => (v_args ->> 'p_entry_id')::uuid,
        p_started_on => (v_args ->> 'p_started_on')::date
      );
      v_result := jsonb_build_object('entry_id', v_session.entry_id, 'session_id', v_session.id);

    when 'finish_reading' then
      perform public.finish_reading(
        p_entry_id => (v_args ->> 'p_entry_id')::uuid,
        p_ended_on => (v_args ->> 'p_ended_on')::date,
        p_rating   => (v_args ->> 'p_rating')::integer,
        p_review   => v_args ->> 'p_review'
      );

    when 'abandon_reading' then
      perform public.abandon_reading(
        p_entry_id => (v_args ->> 'p_entry_id')::uuid,
        p_ended_on => (v_args ->> 'p_ended_on')::date,
        p_reason   => v_args ->> 'p_reason'
      );

    when 'update_progress' then
      -- The member's day, moved into the window when the write waited longer (see above).
      v_day := (v_args ->> 'p_day')::date;
      if v_day < v_today - 1 then
        v_day := v_today - 1;
      end if;
      perform public.update_progress(
        p_entry_id       => (v_args ->> 'p_entry_id')::uuid,
        p_page           => (v_args ->> 'p_page')::integer,
        p_percent        => (v_args ->> 'p_percent')::integer,
        p_set_page_count => coalesce((v_args ->> 'p_set_page_count')::boolean, false),
        p_page_count     => (v_args ->> 'p_page_count')::integer,
        p_day            => v_day,
        p_clear          => coalesce((v_args ->> 'p_clear')::boolean, false)
      );

    when 'update_session' then
      perform public.update_session(
        p_session_id     => (v_args ->> 'p_session_id')::uuid,
        p_started_on     => (v_args ->> 'p_started_on')::date,
        p_ended_on       => (v_args ->> 'p_ended_on')::date,
        p_rating         => (v_args ->> 'p_rating')::integer,
        p_review         => v_args ->> 'p_review',
        p_abandon_reason => v_args ->> 'p_abandon_reason'
      );

    when 'remove_from_library' then
      perform public.remove_from_library(p_entry_id => (v_args ->> 'p_entry_id')::uuid);

    when 'add_to_collection' then
      select * into v_entry from public.add_to_collection(
        p_collection => (v_args ->> 'p_collection')::uuid,
        p_book       => v_args -> 'p_book'
      );
      v_result := jsonb_build_object('entry_id', v_entry.id);

    when 'remove_from_collection' then
      perform public.remove_from_collection(
        p_collection => (v_args ->> 'p_collection')::uuid,
        p_entry      => (v_args ->> 'p_entry')::uuid
      );

    when 'reorder_collection' then
      perform public.reorder_collection(
        p_collection => (v_args ->> 'p_collection')::uuid,
        p_entries    => array(select jsonb_array_elements_text(v_args -> 'p_entries')::uuid)
      );

    when 'rename_collection' then
      perform public.rename_collection(
        p_collection => (v_args ->> 'p_collection')::uuid,
        p_name       => v_args ->> 'p_name'
      );

    when 'delete_collection' then
      perform public.delete_collection(p_collection => (v_args ->> 'p_collection')::uuid);

    when 'save_reader_highlight' then
      perform public.save_reader_highlight(
        p_id            => (v_args ->> 'p_id')::uuid,
        p_entry_id      => (v_args ->> 'p_entry_id')::uuid,
        p_file_hash     => v_args ->> 'p_file_hash',
        p_cfi           => v_args ->> 'p_cfi',
        p_section_index => (v_args ->> 'p_section_index')::integer,
        p_color         => v_args ->> 'p_color',
        p_excerpt       => v_args ->> 'p_excerpt',
        p_note          => v_args ->> 'p_note',
        p_deleted       => coalesce((v_args ->> 'p_deleted')::boolean, false),
        p_at            => (v_args ->> 'p_at')::timestamptz,
        p_created_at    => (v_args ->> 'p_created_at')::timestamptz
      );

    when 'set_entry_hidden' then
      perform public.set_entry_hidden(
        p_entry  => (v_args ->> 'p_entry')::uuid,
        p_hidden => (v_args ->> 'p_hidden')::boolean
      );

    else
      raise exception 'action_invalid' using errcode = '22023';
  end case;

  update public.synced_writes set result = v_result where request_id = p_request_id;
  -- Housekeeping: her own old rows, a handful at most.
  delete from public.synced_writes where member_id = v_member and synced_at < now() - interval '60 days';
  return jsonb_build_object('replayed', false) || v_result;
end;
$$;

comment on function public.sync_write(uuid, text, jsonb) is
  'Applies a write the device queued offline (issue #93) through the same function the online '
  'call uses, at most once per p_request_id: a second send answers with the first result. '
  'Also takes the reader''s highlights (save_reader_highlight, issue #131) and hiding a Book '
  '(set_entry_hidden, social v1).';

revoke all on function public.sync_write(uuid, text, jsonb) from public, anon;
grant execute on function public.sync_write(uuid, text, jsonb) to authenticated;
