-- A waitlist for people who read a reading page and want an invite (issue #171).
--
-- Libellus is invite-only and a public reading page (20261011030000_reading_pages.sql)
-- creates no accounts. Where it used to tell a visitor to ask the member for a code,
-- it now takes her address: "leave your email and we'll send you an invite when
-- there's room". No e-mail is sent yet (inviting, and a confirmation mail first, is
-- for a later change); the owner reads the list in the app and invites by hand.
--
--   private.waitlist            one row per address: who, when, from which page's member, the
--                               wording she agreed to, when she was invited, a note
--   private.waitlist_joins      one row per address a caller added, for the limits only; no
--                               address in it, forgotten after a day
--   join_waitlist(email, token, website)   the only way in: checked, limited, idempotent
--   owner_waitlist()                       the owner's list
--   owner_waitlist_set_invited(ids, on)    mark entries invited (or not)
--   owner_waitlist_delete(id)              remove one entry (a request to be forgotten)
--
-- Nobody reads the table but the owner, through the functions: it lives in `private`,
-- which the API does not expose, with row level security on and no grant to any API role.
--
-- Joining (`join_waitlist`, granted to `anon`: the page is public):
--   * The address is trimmed and compared without regard to case (citext), at most 254
--     characters, one @, a local part of at most 64, a domain with a dot and no empty label.
--     Anything else raises `email_invalid` (22023).
--   * `p_website` is the honeypot: a field no person sees or fills. Anything in it answers
--     'joined' and stores nothing, so a bot learns nothing from the difference.
--   * The same address again answers 'joined' as well and changes nothing (the first entry keeps
--     its date, source and invitation), so the answer never says whether an address was already on
--     the list. The limits come first for the same reason: a caller over a limit is refused before
--     the list is looked at.
--   * Limits, per rolling hour and counted in new entries: 5 per caller (a key made from
--     the caller's address, a salted SHA-256 of it, the way log_client_error does it; the
--     address itself is never stored) and 100 for every caller together, because a
--     forwarded-for header can be made up. Over a limit raises `rate_limited` (54000), which the
--     page words as "try again later".
--   * The page's token only finds whose page it was (`source_member_id`, shown to the owner
--     as her first name); the token itself is never stored. An unknown or dead token joins
--     all the same, from no member. `source` is 'reading_page'.
--   * `consent_text_version` says which wording the person saw beside the button
--     ('2026-10': "We'll only use it to send you an invite; ask us to delete it any time").
--     It changes with that wording (web/i18n/locales/en.json, readingPage.waitlist.consent).
--
-- A member's deletion of her account leaves her page's entries on the list, from no one
-- (`on delete set null`): those people asked for an invite, not for her.

create schema if not exists private;

create table private.waitlist (
  id                   uuid primary key default gen_random_uuid(),
  -- Trimmed; unique without regard to case.
  email                extensions.citext not null unique
                         check (char_length(email::text) between 6 and 254),
  created_at           timestamptz not null default now(),
  source               text not null default 'reading_page' check (source in ('reading_page')),
  -- Whose reading page it was joined from (never the page's token); null when she is gone or the link was dead.
  source_member_id     uuid references auth.users (id) on delete set null,
  consent_text_version text not null check (char_length(consent_text_version) between 1 and 40),
  -- When the owner marked her invited; null = still waiting.
  invited_at           timestamptz,
  note                 text check (char_length(note) <= 1000)
);

create index waitlist_created_at on private.waitlist (created_at desc);
-- The foreign key's own index (an account's deletion nulls these).
create index waitlist_source_member_id on private.waitlist (source_member_id) where source_member_id is not null;

comment on table private.waitlist is
  'Addresses of people who asked for an invite on a reading page (issue #171). Written only by join_waitlist; '
  'read, marked invited and deleted only by the instance owner (owner_waitlist*). No e-mail is sent from it.';

alter table private.waitlist enable row level security;
revoke all on private.waitlist from public, anon, authenticated;

-- What the limits count: a caller's key and when, without the address it joined. Forgotten after a day.
create table private.waitlist_joins (
  id         bigint generated always as identity primary key,
  caller_key text not null,
  created_at timestamptz not null default now()
);

create index waitlist_joins_caller_created_at on private.waitlist_joins (caller_key, created_at);
create index waitlist_joins_created_at on private.waitlist_joins (created_at);

comment on table private.waitlist_joins is
  'One row per new waitlist entry, with its caller''s salted key and the time: the hourly limits of join_waitlist. '
  'Holds no address and is emptied of rows older than a day by join_waitlist itself.';

alter table private.waitlist_joins enable row level security;
revoke all on private.waitlist_joins from public, anon, authenticated;

-- ------------------------------------------------------------------ the shape

-- Whether text is an e-mail address worth keeping: not a proof it exists (nothing is sent), only its shape.
create function private.waitlist_email_ok(p_email text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_email is not null
     and char_length(p_email) between 6 and 254
     and p_email !~ '[[:cntrl:][:space:]<>(),;:"\\\[\]]'
     and char_length(split_part(p_email, '@', 1)) between 1 and 64
     and (char_length(p_email) - char_length(replace(p_email, '@', ''))) = 1
     and split_part(p_email, '@', 1) !~ '^\.|\.$|\.\.'
     -- A domain of labels with something in them, at least one dot, and a last label of two or more.
     and split_part(p_email, '@', 2) ~ '^[^.@-][^.@]*(\.[^.@]+)*\.[^.@]{2,}$'
     and split_part(p_email, '@', 2) !~ '(^|\.)-|-(\.|$)'
$$;

revoke all on function private.waitlist_email_ok(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ the write

create function public.join_waitlist(p_email text, p_token text default null, p_website text default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_member   uuid;
  v_headers  jsonb;
  v_address  text;
  v_caller   text;
  v_recent   bigint;
  v_id       uuid;
  -- The wording beside the button this answer is for (see the header).
  c_consent  constant text := '2026-10';
  -- New entries a caller may make in an hour, and all callers together.
  c_caller   constant integer := 5;
  c_all      constant integer := 100;
begin
  -- A bot that filled the field nobody sees: thanked, and forgotten.
  if btrim(coalesce(p_website, '')) <> '' then
    return 'joined';
  end if;

  if not private.waitlist_email_ok(v_email) then
    raise exception 'email_invalid' using errcode = '22023';
  end if;

  -- Who the caller is, as log_client_error knows a signed-out one: a salted hash of the first address.
  v_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_address := coalesce(
    nullif(btrim(v_headers ->> 'cf-connecting-ip'), ''),
    nullif(btrim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''),
    nullif(btrim(v_headers ->> 'x-real-ip'), ''),
    'unknown');
  v_caller := left(encode(sha256(convert_to(
    'waitlist:' || v_address || (select salt from private.client_error_salt), 'UTF8')), 'hex'), 32);

  -- One join of a caller at a time, and one of all callers at a time, so two at once cannot both slip under a limit.
  perform pg_advisory_xact_lock(hashtext('join_waitlist:all'));
  perform pg_advisory_xact_lock(hashtext('join_waitlist:' || v_caller));

  delete from private.waitlist_joins where created_at < now() - interval '1 day';

  -- The limits come before anything is looked up in the list: a refusal never tells whether the address is there.
  select count(*) into v_recent from private.waitlist_joins j
   where j.caller_key = v_caller and j.created_at > now() - interval '1 hour';
  if v_recent >= c_caller then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  select count(*) into v_recent from private.waitlist_joins j where j.created_at > now() - interval '1 hour';
  if v_recent >= c_all then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  -- Whose page it was; the token itself goes no further than this lookup.
  if p_token is not null and p_token ~ '^[A-Za-z0-9_-]{22}$' then
    select r.member_id into v_member from public.reading_pages r where r.token = p_token;
  end if;

  insert into private.waitlist (email, source, source_member_id, consent_text_version)
  values (v_email::extensions.citext, 'reading_page', v_member, c_consent)
  on conflict (email) do nothing
  returning id into v_id;

  if v_id is not null then
    insert into private.waitlist_joins (caller_key) values (v_caller);
  end if;

  -- The same answer whether she was new or already there.
  return 'joined';
end;
$$;

comment on function public.join_waitlist(text, text, text) is
  'A visitor of a reading page asks for an invite (private.waitlist): the address trimmed and checked (email_invalid), '
  'the page''s token only to find whose page it was (never stored), 5 new entries an hour per caller and 100 in all '
  '(rate_limited), the same address again and a filled honeypot (p_website) both answer joined and change nothing.';

revoke all on function public.join_waitlist(text, text, text) from public;
grant execute on function public.join_waitlist(text, text, text) to anon, authenticated;

-- --------------------------------------------------------------- the owner's side

create function public.owner_waitlist()
returns table (
  id           uuid,
  email        text,
  created_at   timestamptz,
  invited_at   timestamptz,
  source       text,
  member_name  text,
  note         text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  return query
    select w.id, w.email::text, w.created_at, w.invited_at, w.source,
           case when w.source_member_id is null then null else private.reading_page_name(w.source_member_id) end,
           w.note
      from private.waitlist w
     order by w.created_at desc, w.id
     limit 5000;
end;
$$;

comment on function public.owner_waitlist() is
  'The instance owner''s waitlist, newest first (at most 5000): address, when she joined, when she was invited, where '
  'from (the first name of the member whose page it was, when she gave one) and the note. Raises not_owner for anyone else.';

revoke all on function public.owner_waitlist() from public, anon;
grant execute on function public.owner_waitlist() to authenticated;

create function public.owner_waitlist_set_invited(p_ids uuid[], p_invited boolean default true)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  update private.waitlist w
     set invited_at = case when coalesce(p_invited, true) then coalesce(w.invited_at, now()) end
   where w.id = any (coalesce(p_ids, '{}'));
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

comment on function public.owner_waitlist_set_invited(uuid[], boolean) is
  'Marks waitlist entries invited (now, kept when already set) or, with false, waiting again. Answers how many entries '
  'it found. Raises not_owner for anyone but the instance owner. Sends nothing.';

revoke all on function public.owner_waitlist_set_invited(uuid[], boolean) from public, anon;
grant execute on function public.owner_waitlist_set_invited(uuid[], boolean) to authenticated;

create function public.owner_waitlist_delete(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  delete from private.waitlist w where w.id = p_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

comment on function public.owner_waitlist_delete(uuid) is
  'Removes one waitlist entry for good (a request to be forgotten); false when it was already gone. Raises not_owner '
  'for anyone but the instance owner.';

revoke all on function public.owner_waitlist_delete(uuid) from public, anon;
grant execute on function public.owner_waitlist_delete(uuid) to authenticated;
