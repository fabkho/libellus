-- Social v1, D3: the activity a member's reading writes (docs/proposals/social-v1-contract.md §1.3).
--
-- What a member's reading leaves behind for the people who follow her: one row in
-- `public.activity` each time she adds a Book to Want to read, starts a read, finishes
-- it, puts it down, or writes the review of a finished read later (`want`, `started`,
-- `finished`, `abandoned`, `reviewed`). Written by triggers on the two tables every
-- path of hers already writes through (the RPCs, `sync_write`, which calls them), so
-- no existing write is rewritten and none behaves differently:
--
--   reading_sessions_activity   after insert / update of outcome, review   → started, finished, abandoned, reviewed
--   library_entries_activity    after insert                               → want
--
-- Every body is wrapped as `private.shelf_publish_on_session` is: a failure raises a
-- warning and never fails the library write. The rules run in the contract's order:
--
--   0 same statement  a session first deletes its entry's `want` written in the same
--                     statement (add_to_library with a status): the session replaces it
--   1 quiet           nothing without a member (service role, the owner's scripts), when
--                     `libellus.quiet` is 'on', or inside `import_books` (see below)
--   2 old news        no finished / abandoned for a read that ended more than 14 days
--                     ago (UTC), or without an end date
--   3 settle          a row is visible only after `private.social_config.settle_window`;
--                     a correction inside the window replaces what was written (want →
--                     started → finished / abandoned) instead of adding to it
--   4 once            at most one row per (session, kind)
--
-- Quiet imports. The contract set `libellus.quiet = 'on'` on the imports with `alter
-- function`; a function-level SET of a custom parameter needs superuser (PG 15+:
-- "permission denied to set parameter"), which a migration is not, locally or hosted.
-- So `private.activity_quiet()` looks at the call stack instead (GET DIAGNOSTICS
-- PG_CONTEXT): a write made inside `public.import_books` is quiet, with neither import
-- rewritten. `libellus.quiet = 'on'` set at run time is honoured too. `import_book_for`
-- needs nothing: it only finds or makes Book rows, never library entries or sessions,
-- so it writes no activity either way.
--
-- `reviewed` is written only for a review added to a read already finished, once that
-- finish is visible: a review written with, or before the visibility of, the finish
-- goes with the finish.
--
-- `activity` is read only through the D4 functions: RLS on, no policy, no grant.
-- Rows go with their read (`on delete cascade` of the session) and their entry; rows
-- older than 13 months are purged daily where pg_cron exists.

-- ------------------------------------------------------------------- the table

create table public.activity (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references auth.users on delete cascade,
  entry_id   uuid not null references public.library_entries on delete cascade,
  session_id uuid references public.reading_sessions on delete cascade,
  kind       text not null check (kind in ('want', 'started', 'finished', 'abandoned', 'reviewed')),
  on_day     date,
  created_at timestamptz not null default now(),
  visible_at timestamptz not null
);
create index activity_feed on public.activity (member_id, visible_at desc, id desc);
create index activity_entry on public.activity (entry_id);
-- Rule 4. A `want` row has no session, and null session ids never collide.
create unique index activity_once on public.activity (session_id, kind);

alter table public.activity enable row level security;
revoke all on public.activity from anon, authenticated;

comment on table public.activity is
  'What a member''s reading wrote for her followers: want, started, finished, abandoned, reviewed. '
  'Written by triggers on reading_sessions and library_entries; read only through definer functions.';

-- ------------------------------------------------------------------- the triggers

-- Rule 1, past "no member": is this write quiet? The cheap checks first, the stack last.
create function private.activity_quiet()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context text;
begin
  if auth.uid() is null or coalesce(current_setting('libellus.quiet', true), '') = 'on' then
    return true;
  end if;
  get diagnostics v_context = pg_context;
  return v_context ~ 'function (public\.)?import_books\(';
end;
$$;

-- A session inserted, closed or reviewed.
create function private.activity_on_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind    text;
  v_day     date;
  v_member  uuid;
  v_visible timestamptz;
begin
  begin
    -- 0. The entry's `want`, written by the statement that is writing this session.
    delete from public.activity
     where entry_id = new.entry_id
       and kind = 'want'
       and created_at = statement_timestamp();

    -- 1. Quiet.
    if private.activity_quiet() then
      return null;
    end if;

    -- What this write is.
    if tg_op = 'INSERT' then
      if new.outcome is null then
        v_kind := 'started';
        v_day := new.started_on;
      else
        v_kind := new.outcome::text;
        v_day := new.ended_on;
      end if;
    elsif old.outcome is null and new.outcome is not null then
      v_kind := new.outcome::text;
      v_day := new.ended_on;
    elsif old.review is null and new.review is not null and old.outcome = 'finished' then
      v_kind := 'reviewed';
      v_day := new.ended_on;
    else
      return null;
    end if;

    -- 2. Old news.
    if v_kind in ('finished', 'abandoned')
       and (new.ended_on is null or new.ended_on < (now() at time zone 'utc')::date - 14) then
      return null;
    end if;

    -- A review counts once the finish it follows is visible.
    if v_kind = 'reviewed' and not exists (
      select 1 from public.activity a
       where a.session_id = new.id and a.kind = 'finished' and a.visible_at <= now()
    ) then
      return null;
    end if;

    select e.member_id into v_member from public.library_entries e where e.id = new.entry_id;
    if v_member is null then
      return null;
    end if;

    -- 3. Settle. A correction inside the window replaces what was written; `reviewed`
    -- replaces nothing.
    v_visible := now() + (select c.settle_window from private.social_config c);
    if v_kind <> 'reviewed' then
      delete from public.activity
       where visible_at > now()
         and (session_id = new.id or (entry_id = new.entry_id and kind = 'want'));
    end if;

    -- 4. Once.
    insert into public.activity (member_id, entry_id, session_id, kind, on_day, visible_at)
    values (v_member, new.entry_id, new.id, v_kind, v_day, v_visible)
    on conflict (session_id, kind) do nothing;
  exception when others then
    raise warning 'activity not written for session %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

-- An entry added: she wants to read it. Not deferred: a deferred trigger would fire
-- after an import had returned, outside its call stack. `created_at` is the
-- statement's, which is how a session written by the same statement finds it (rule 0).
create function private.activity_on_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    -- 1. Quiet.
    if private.activity_quiet() then
      return null;
    end if;

    insert into public.activity (member_id, entry_id, kind, on_day, created_at, visible_at)
    values (new.member_id, new.id, 'want', new.added_at::date, statement_timestamp(),
            now() + (select c.settle_window from private.social_config c));
  exception when others then
    raise warning 'activity not written for entry %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function private.activity_quiet() from public, anon, authenticated;
revoke all on function private.activity_on_session() from public, anon, authenticated;
revoke all on function private.activity_on_entry() from public, anon, authenticated;

create trigger reading_sessions_activity
  after insert or update of outcome, review on public.reading_sessions
  for each row execute function private.activity_on_session();

create trigger library_entries_activity
  after insert on public.library_entries
  for each row execute function private.activity_on_entry();

-- ------------------------------------------------------------------- purging

create function private.purge_activity()
returns bigint
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.activity
    where created_at < now() - interval '13 months'
    returning 1
  )
  select count(*) from gone;
$$;

comment on function private.purge_activity() is
  'Deletes the activity rows created more than 13 months ago and answers how many. Run daily by pg_cron.';

revoke all on function private.purge_activity() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
      begin
        create extension pg_cron;
      exception when others then
        raise notice 'pg_cron could not be enabled (%): purge_activity() is not scheduled', sqlerrm;
      end;
    else
      raise notice 'pg_cron is not available here: purge_activity() is not scheduled';
    end if;
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      -- By name: scheduling again replaces the job instead of doubling it.
      perform cron.schedule('purge-activity', '45 3 * * *', 'select private.purge_activity()');
    exception when others then
      raise notice 'purge-activity could not be scheduled (%)', sqlerrm;
    end;
  end if;
end;
$$;
