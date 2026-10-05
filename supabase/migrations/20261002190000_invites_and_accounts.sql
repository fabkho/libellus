-- Access: invite codes, accounts, and the signup gate (SPEC.md, Access).
--
-- Ported from Trappist's passwordless flow, without profiles, roles, terms or
-- admin tooling: an account is an address that proved itself with an invite.
--
-- How a signup runs through GoTrue:
--   1. The form asks for a six-digit code. GoTrue creates the auth user (still
--      unconfirmed) and mails the code. The insert trigger only JUDGES the
--      invite: a refusal rolls the new auth user back, so a signup the
--      database refuses never existed. Nothing is spent yet — a mistyped
--      address must not burn a single-use code.
--   2. The member types the code. `email_confirmed_at` turns from null into a
--      time, and the confirmation trigger judges again, under a lock (the last
--      slot may have gone while the mail sat unread), consumes one use and
--      creates the account.

create extension if not exists citext;

-- ---------------------------------------------------------------- invite codes

create table public.invite_codes (
  id          uuid primary key default gen_random_uuid(),
  code        citext not null unique,
  label       text,
  max_uses    integer not null default 1 check (max_uses > 0),
  uses        integer not null default 0 check (uses >= 0),
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint invite_codes_code_len check (char_length(code) between 4 and 32),
  constraint invite_codes_not_overused check (uses <= max_uses)
);

comment on table public.invite_codes is
  'Owner-created signup codes. Never readable by members; looked at through security-definer '
  'functions only.';

-- ------------------------------------------------------------------- accounts

create table public.accounts (
  id              uuid primary key references auth.users on delete cascade,
  invite_code_id  uuid references public.invite_codes on delete set null,
  created_at      timestamptz not null default now()
);

comment on table public.accounts is
  'One row per auth user: the invite it came in on. Private to its owner. Created when the '
  'address is proved; deleted with the auth user.';

-- ------------------------------------------------------------------------ RLS

alter table public.invite_codes enable row level security;
alter table public.accounts     enable row level security;

-- A new table in `public` arrives with everything granted to the API roles
-- (Supabase's default privileges), the opposite of what these tables want, so
-- the slate is wiped first. A member has no business in the code table at all,
-- not even a filtered-away one: no policy exists on it, and no grant either.
revoke all on public.invite_codes from anon, authenticated;
revoke all on public.accounts from anon, authenticated;

-- No insert, update or delete: rows are made by the confirmation trigger and
-- die with the auth user.
grant select on public.accounts to authenticated;

create policy accounts_select_own on public.accounts
  for select to authenticated using (id = (select auth.uid()));

-- ------------------------------------------------------------- invite checks

-- The gate both halves of a signup run through. Raises the first thing wrong
-- with the invite in `p_meta` (the user metadata the form sent along), returns
-- the row otherwise. Only the confirmation goes on to consume the row, so only
-- the confirmation locks it.
create or replace function public.signup_invite(p_meta jsonb, p_lock boolean)
returns public.invite_codes
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_code text := nullif(trim(p_meta ->> 'invite_code'), '');
  v_invite public.invite_codes%rowtype;
begin
  if v_code is null then
    raise exception 'invite_code_required' using errcode = 'check_violation';
  end if;

  if p_lock then
    select * into v_invite from public.invite_codes where code = v_code::citext for update;
  else
    select * into v_invite from public.invite_codes where code = v_code::citext;
  end if;

  if not found then
    raise exception 'invite_code_invalid' using errcode = 'check_violation';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'invite_code_expired' using errcode = 'check_violation';
  end if;
  if v_invite.uses >= v_invite.max_uses then
    raise exception 'invite_code_exhausted' using errcode = 'check_violation';
  end if;

  return v_invite;
end;
$$;

revoke all on function public.signup_invite(jsonb, boolean) from public, anon, authenticated;

-- Pre-flight for the sign-up form, so a wrong code fails against the field that
-- caused it and no auth user is created a moment before the trigger would roll
-- it back. Says whether a code is usable and, if not, why — never the row.
-- (GoTrue does not pass a trigger's message on, so this is the only place the
-- reason can reach the form. The trigger still enforces everything.)
create or replace function public.invite_code_status(p_code text)
returns text
language plpgsql
security definer
stable
set search_path = public, pg_catalog
as $$
begin
  perform public.signup_invite(jsonb_build_object('invite_code', p_code), false);
  return 'valid';
exception when check_violation then
  return case sqlerrm
    when 'invite_code_required' then 'missing'
    when 'invite_code_expired' then 'expired'
    when 'invite_code_exhausted' then 'exhausted'
    else 'invalid'
  end;
end;
$$;

revoke all on function public.invite_code_status(text) from public;
grant execute on function public.invite_code_status(text) to anon, authenticated;

-- Everything a proved address earns: one invite use and an account.
create or replace function public.admit_user(p_id uuid, p_meta jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_invite public.invite_codes%rowtype;
begin
  -- An address can be confirmed more than once (an email change, a row fixed by
  -- hand). The invite was already paid for the first time.
  if exists (select 1 from public.accounts where id = p_id) then
    return;
  end if;

  v_invite := public.signup_invite(p_meta, true);

  update public.invite_codes set uses = uses + 1 where id = v_invite.id;
  insert into public.accounts (id, invite_code_id) values (p_id, v_invite.id);
end;
$$;

revoke all on function public.admit_user(uuid, jsonb) from public, anon, authenticated;

-- Judge only. The exception rolls the auth user back, so a signup the database
-- refuses never existed; what it does not do is spend anything on a signup that
-- may never be finished.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  perform public.signup_invite(new.raw_user_meta_data, false);

  -- Unless the address arrives proved: a user created from the dashboard or by
  -- the seed, or a stack running with email confirmations off. Then there is no
  -- second chance.
  if new.email_confirmed_at is not null then
    perform public.admit_user(new.id, new.raw_user_meta_data);
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  perform public.admit_user(new.id, new.raw_user_meta_data);
  return new;
end;
$$;

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_user_confirmed();

-- ------------------------------------------------------------ abandoned signups

-- The flip side of admitting late: an address typed in and never proved leaves
-- an auth user sitting on it, and the real owner of that address could never
-- sign up. It costs no invite, so a generous day is plenty — long enough for
-- anyone to find the mail, short enough that a typo is not permanent.
create or replace function public.purge_abandoned_signups()
returns integer
language sql
security definer
set search_path = public, pg_catalog
as $$
  with gone as (
    delete from auth.users
    where email_confirmed_at is null
      and created_at < now() - interval '1 day'
    returning 1
  )
  select count(*)::int from gone;
$$;

revoke all on function public.purge_abandoned_signups() from public, anon, authenticated;

create extension if not exists pg_cron;

-- Scheduling by name is an upsert, so re-running this migration is harmless.
select cron.schedule('purge-abandoned-signups', '0 * * * *',
  $$ select public.purge_abandoned_signups() $$);

-- ------------------------------------------------------------ creating invites

-- The owner's tool (scripts/create-invite-code.sh calls it through the REST API
-- with the service-role key; psql as the postgres role works as well). Not
-- granted to members: `invite_codes` is closed to them for a reason.
--
-- Without a code the function makes one: eight characters from an alphabet
-- without the look-alikes (0/O, 1/I), grouped as XXXX-XXXX to be read out loud.
create or replace function public.create_invite_code(
  p_max_uses integer default 1,
  p_expires_at timestamptz default null,
  p_label text default null,
  p_code text default null
)
returns public.invite_codes
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := nullif(trim(p_code), '');
  v_row public.invite_codes;
begin
  if v_code is null then
    v_code := '';
    for i in 1..8 loop
      -- 256 is a multiple of 32, so every character is equally likely.
      v_code := v_code || substr(v_alphabet,
        1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(v_alphabet)), 1);
      if i = 4 then v_code := v_code || '-'; end if;
    end loop;
  end if;

  insert into public.invite_codes (code, label, max_uses, expires_at)
  values (v_code, p_label, p_max_uses, p_expires_at)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_invite_code(integer, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.create_invite_code(integer, timestamptz, text, text)
  to service_role;
