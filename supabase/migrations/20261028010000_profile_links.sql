-- Profile links (WP-22, backlog #5): a member's profiles on other platforms, in the safe shape.
--
-- What is stored is a validated HANDLE or canonical id per allow-listed platform, never a URL and never
-- free text: the app builds the outgoing address itself from a fixed template per platform
-- (web/app/utils/socialLinks.ts, the one place that knows the templates). So a member cannot point a
-- link anywhere, and the table cannot hold a phishing address however a client is written.
--
--   public.profile_links          (member_id, platform, handle, created_at), one row per platform
--                                 (the primary key), so at most one per `link_platform` value: five.
--                                 The handle is checked per platform, in its canonical form (below).
--   public.profile_link_settings  who sees them: 'followers' (the default), 'everyone' or 'me'. Its
--                                 own table on purpose: it touches neither `social_settings` nor
--                                 `private.my_social_json`, so no existing function is replaced.
--   private.profile_link_calls    calls of set_profile_links(), for the hourly limit
--
--   set_profile_links(links, visibility)  her side: writes the whole list (and, when given, who sees
--                                         it), cleaned and checked here, at most 10 calls an hour
--   my_profile_links()                    her side: her links and her setting
--   profile_links_of(member)              another member's links, only what her setting lets the
--                                         caller see; an empty list otherwise (never a refusal that
--                                         tells a stranger anything)
--   owner_clear_profile_links(member)     the owner's action on a member's links, for the report flow
--                                         (WP-25) that comes with open sign-up (#331)
--
-- Canonical form (what the table holds; `private.profile_link_clean` turns what a member typed into it):
--
--   instagram  1-30 of a-z 0-9 . _ ; no leading or trailing or doubled dot      -> `name`
--   tiktok     2-24 of a-z 0-9 . _ ; no leading dot, no trailing dot           -> `name` (an @ is stripped)
--   youtube    `@name`, 3-30 of a-z 0-9 . _ - (the @ keeps it apart from an id), or a channel id
--              `UC` and 22 of A-Za-z0-9_- (case matters in an id)
--   goodreads  the number in goodreads.com/user/show/<id>: digits, 1 to 12, no leading zero
--   reado      2-30 of A-Za-z0-9 . _ ; as typed (reado.app/en/profile/<name>; its own rules for a name
--              are not published, the pattern is a safe subset of what the pages show)
--
-- Instagram, TikTok and YouTube handles are lower-cased (the platforms ignore case). The check runs on
-- the ASCII letters as typed first, so a look-alike (a Kelvin sign, a Cyrillic a) is refused rather
-- than folded into a letter.
--
-- Refusals (the message is the code): not_signed_in (42501), link_invalid:<platform> (22023: a handle
-- that fails its platform's format, a URL included), links_invalid (22023: not a list of
-- { platform, handle }, an unknown platform, one twice), visibility_invalid (22023), rate_limited
-- (PT429).
--
-- Deleted with the member: both tables cascade from auth.users (so delete_my_account takes them along).

-- ---------------------------------------------------------------------------- platforms

create type public.link_platform as enum ('goodreads', 'reado', 'youtube', 'instagram', 'tiktok');

-- ----------------------------------------------------------------------------- helpers

-- Whether this is a handle in the canonical form of its platform. Immutable and ASCII only: every
-- class is written out ([0-9], never \d, which also takes other scripts' digits).
create function private.profile_link_ok(p_platform public.link_platform, p_handle text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_handle is not null and case p_platform
    when 'instagram' then
      p_handle ~ '^[a-z0-9_]([a-z0-9._]{0,28}[a-z0-9_])?$' and p_handle !~ '\.\.'
    when 'tiktok' then
      p_handle ~ '^[a-z0-9_]([a-z0-9._]{0,22}[a-z0-9_])$'
    when 'youtube' then
      p_handle ~ '^@[a-z0-9_-][a-z0-9._-]{1,28}[a-z0-9_-]$' or p_handle ~ '^UC[A-Za-z0-9_-]{22}$'
    when 'goodreads' then
      p_handle ~ '^[1-9][0-9]{0,11}$'
    when 'reado' then
      p_handle ~ '^[A-Za-z0-9_][A-Za-z0-9._]{0,28}[A-Za-z0-9_]$'
  end
$$;

-- What a member typed, as the table holds it: trimmed, a leading @ off (kept for a YouTube handle,
-- where it is part of the form), lower-cased where the platform ignores case. Letters are checked
-- as typed first, so a look-alike is not folded into one. The result is not yet checked: the caller
-- passes it to profile_link_ok. A value that cannot be a handle at all comes back as it is.
create function private.profile_link_clean(p_platform public.link_platform, p_raw text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v text := btrim(coalesce(p_raw, ''), E' \t\r\n');
begin
  if v = '' then
    return v;
  end if;
  if p_platform = 'youtube' then
    -- A channel id is kept as it is; anything else is a handle, with its @.
    if v ~ '^UC[A-Za-z0-9_-]{22}$' then
      return v;
    end if;
    if v !~ '^@?[A-Za-z0-9._-]*$' then
      return v;
    end if;
    return '@' || lower(regexp_replace(v, '^@', ''));
  end if;
  if p_platform = 'goodreads' then
    return v;
  end if;
  v := regexp_replace(v, '^@', '');
  if v !~ '^[A-Za-z0-9._]*$' then
    return v;
  end if;
  return case p_platform when 'reado' then v else lower(v) end;
end;
$$;

revoke all on function private.profile_link_ok(public.link_platform, text) from public, anon, authenticated;
revoke all on function private.profile_link_clean(public.link_platform, text) from public, anon, authenticated;

-- ------------------------------------------------------------------------------ tables

create table public.profile_links (
  member_id  uuid not null references auth.users on delete cascade,
  platform   public.link_platform not null,
  handle     text not null,
  created_at timestamptz not null default now(),
  primary key (member_id, platform),
  constraint profile_links_handle_ok check (private.profile_link_ok(platform, handle))
);

comment on table public.profile_links is
  'Profile links (WP-22): one validated handle or canonical id per allow-listed platform and member, never a URL. '
  'The app builds the address (web/app/utils/socialLinks.ts). Read by its member only; written through set_profile_links, '
  'read by others through profile_links_of. See 20261028010000_profile_links.sql.';

create table public.profile_link_settings (
  member_id  uuid primary key references auth.users on delete cascade,
  visibility text not null default 'followers' check (visibility in ('everyone', 'followers', 'me')),
  updated_at timestamptz not null default now()
);

comment on table public.profile_link_settings is
  'Profile links (WP-22): who sees a member''s links: her accepted followers (the default, also with no row), '
  'everyone who can see her profile, or only herself.';

create table private.profile_link_calls (
  member_id uuid not null references auth.users on delete cascade,
  at        timestamptz not null default now()
);

create index profile_link_calls_member_at on private.profile_link_calls (member_id, at);

alter table public.profile_links enable row level security;
alter table public.profile_link_settings enable row level security;

revoke all on public.profile_links from anon, authenticated;
revoke all on public.profile_link_settings from anon, authenticated;
grant select on public.profile_links to authenticated;
grant select on public.profile_link_settings to authenticated;

-- Her own rows, and nobody else's: other members go through profile_links_of, which applies her setting.
create policy profile_links_select_own on public.profile_links
  for select to authenticated using (member_id = (select auth.uid()));
create policy profile_link_settings_select_own on public.profile_link_settings
  for select to authenticated using (member_id = (select auth.uid()));

-- ------------------------------------------------------------------------------ her side

-- Her links as a list of { platform, handle } in the platforms' order, and her setting.
create function private.my_profile_links_json(p_member uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'links', coalesce((select jsonb_agg(jsonb_build_object('platform', l.platform, 'handle', l.handle)
                                        order by l.platform)
                         from public.profile_links l where l.member_id = p_member), '[]'::jsonb),
    'visibility', coalesce((select s.visibility from public.profile_link_settings s where s.member_id = p_member),
                           'followers')
  )
$$;

revoke all on function private.my_profile_links_json(uuid) from public, anon, authenticated;

create function public.my_profile_links()
returns jsonb
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
  return private.my_profile_links_json(v_member);
end;
$$;

-- Replaces her whole list. `p_links`: [{ "platform": "instagram", "handle": "name" }, ...]; a platform
-- she leaves out is removed, an empty list clears them. `p_visibility`: null keeps her setting.
create function public.set_profile_links(p_links jsonb, p_visibility text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_member   uuid := auth.uid();
  v_item     jsonb;
  v_platform public.link_platform;
  v_handle   text;
  v_seen     public.link_platform[] := '{}';
  v_rows     jsonb := '[]'::jsonb;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_links is null or jsonb_typeof(p_links) <> 'array'
     or jsonb_array_length(p_links) > cardinality(enum_range(null::public.link_platform)) then
    raise exception 'links_invalid' using errcode = '22023';
  end if;
  if p_visibility is not null and p_visibility not in ('everyone', 'followers', 'me') then
    raise exception 'visibility_invalid' using errcode = '22023';
  end if;

  -- Every item first, so a refusal leaves her list as it was.
  for v_item in select * from jsonb_array_elements(p_links) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'platform') is distinct from 'string'
       or jsonb_typeof(v_item -> 'handle') is distinct from 'string'
       or v_item ->> 'platform' not in (select e::text from unnest(enum_range(null::public.link_platform)) e) then
      raise exception 'links_invalid' using errcode = '22023';
    end if;
    v_platform := (v_item ->> 'platform')::public.link_platform;
    if v_platform = any (v_seen) then
      raise exception 'links_invalid' using errcode = '22023';
    end if;
    v_seen := v_seen || v_platform;
    v_handle := private.profile_link_clean(v_platform, v_item ->> 'handle');
    if not private.profile_link_ok(v_platform, v_handle) then
      raise exception 'link_invalid:%', v_platform using errcode = '22023';
    end if;
    v_rows := v_rows || jsonb_build_object('platform', v_platform, 'handle', v_handle);
  end loop;

  -- One call at a time per member, so that parallel calls cannot slip past the limit.
  perform pg_advisory_xact_lock(hashtextextended('profile_links:' || v_member::text, 0));
  if (select count(*) from private.profile_link_calls
       where member_id = v_member and at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  delete from private.profile_link_calls where member_id = v_member and at < now() - interval '1 day';
  insert into private.profile_link_calls (member_id) values (v_member);

  delete from public.profile_links
   where member_id = v_member
     and platform::text not in (select r ->> 'platform' from jsonb_array_elements(v_rows) r);
  insert into public.profile_links (member_id, platform, handle)
  select v_member, (r ->> 'platform')::public.link_platform, r ->> 'handle'
    from jsonb_array_elements(v_rows) r
  on conflict (member_id, platform) do update set handle = excluded.handle;

  if p_visibility is not null then
    insert into public.profile_link_settings (member_id, visibility)
    values (v_member, p_visibility)
    on conflict (member_id) do update set visibility = excluded.visibility, updated_at = now();
  end if;

  return private.my_profile_links_json(v_member);
end;
$$;

-- --------------------------------------------------------------------------- others' side

-- Another member's links, as a list of { platform, handle } the caller may see; an empty list for
-- everyone else, so nobody learns whether she has links, or a setting, or is a member at all.
--   herself              always, whatever her setting
--   'me'                 nobody else
--   'followers'          the default: a member she accepted as a follower, who can reach her (so never
--                        across a block either way)
--   'everyone'           whoever may see her profile (private.visible: reachable, and public or followed)
create function public.profile_links_of(p_member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller     uuid := auth.uid();
  v_visibility text;
  v_allowed    boolean;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_member is null then
    return '[]'::jsonb;
  end if;
  if v_caller = p_member then
    return private.my_profile_links_json(v_caller) -> 'links';
  end if;

  select coalesce(
           (select s.visibility from public.profile_link_settings s where s.member_id = p_member),
           'followers')
    into v_visibility;
  v_allowed := case v_visibility
    when 'everyone' then private.visible(v_caller, p_member)
    when 'followers' then private.reachable(v_caller, p_member)
                          and exists (select 1 from public.follows f
                                       where f.follower_id = v_caller and f.followee_id = p_member
                                         and f.accepted_at is not null)
    else false
  end;
  if not coalesce(v_allowed, false) then
    return '[]'::jsonb;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('platform', l.platform, 'handle', l.handle)
                                    order by l.platform)
                     from public.profile_links l where l.member_id = p_member), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------- the owner's side

-- The owner removes a member's links (a report about them, WP-25). The owner is the instance owner,
-- as for the feedback inbox and the waitlist (private.is_instance_owner). Her setting stays.
create function public.owner_clear_profile_links(p_member uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_removed integer;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  delete from public.profile_links where member_id = p_member;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function public.my_profile_links() from public, anon;
revoke all on function public.set_profile_links(jsonb, text) from public, anon;
revoke all on function public.profile_links_of(uuid) from public, anon;
revoke all on function public.owner_clear_profile_links(uuid) from public, anon;
grant execute on function public.my_profile_links() to authenticated;
grant execute on function public.set_profile_links(jsonb, text) to authenticated;
grant execute on function public.profile_links_of(uuid) to authenticated;
grant execute on function public.owner_clear_profile_links(uuid) to authenticated;
