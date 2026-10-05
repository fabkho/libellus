-- The portfolio's shelf follows the owner's reads (issue #110).
--
-- Regal (fabkho/regal) publishes the owner's shelf on fabkho.dev/books from
-- this database: its workflow `publish-shelf.yml` reads the `regal-export` edge
-- function and publishes the result, daily and whenever GitHub gets a
-- `repository_dispatch` of type `libellus-changed`. This sends that dispatch
-- when the owner's Library changes, so a finished book reaches the portfolio
-- within minutes instead of the next morning:
--
--   a change to the owner's library_entries or reading_sessions (reads, Ratings,
--   reviews, progress: progress lives on the session)
--     → private.shelf_publish_changed(member)    owner only; notes the change
--     → private.shelf_publish_dispatch()         at most one dispatch per 10 minutes
--     → pg_net → POST https://api.github.com/repos/fabkho/regal/dispatches
--
-- Debounced on a stored timestamp: a change within 10 minutes of the last
-- dispatch only notes itself (`last_changed_at`); pg_cron's 'shelf-publish'
-- job (every five minutes) sends the dispatch it is owed once the 10 minutes
-- are up, so the last edit of a burst is never left for the next day.
--
-- Who the owner is lives in one row, `private.shelf_publish`, empty here: no
-- address in SQL. Filled once on the hosted project (README, Feeding Regal):
--
--   update private.shelf_publish
--      set owner_id = (select id from auth.users where email = '<owner>');
--
-- The GitHub token is the Vault secret `github_dispatch_token` (a fine-grained
-- token with Contents read and write on fabkho/regal only). Without it, without
-- pg_net or without an owner, nothing is sent and nothing fails: the local stack
-- and the tests never call out. A dispatch that cannot be sent never blocks the
-- member's write either: the trigger turns every error into a warning.
--
-- Everything lives in the schema `private`, which the API does not expose and
-- the API roles cannot use.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- pg_net sends the request after the transaction commits (a rolled-back change
-- sends nothing). A Supabase extension: enabled where it can be, as pg_cron is
-- in 20261005094846_synced_writes_cleanup.sql; elsewhere the dispatch is a no-op.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    begin
      create extension pg_net;
    exception when others then
      raise notice 'pg_net could not be enabled (%): the shelf is published daily only', sqlerrm;
    end;
  end if;
end;
$$;

-- ---------------------------------------------------------------- the settings

create table private.shelf_publish (
  -- One row: `id` can only be true.
  id                 boolean primary key default true check (id),
  -- Whose changes send the dispatch; null = nobody's (off).
  owner_id           uuid references auth.users on delete set null,
  repository         text not null default 'fabkho/regal' check (repository ~ '^[\w.-]+/[\w.-]+$'),
  event_type         text not null default 'libellus-changed' check (event_type ~ '^[\w.-]{1,100}$'),
  min_interval       interval not null default interval '10 minutes' check (min_interval >= interval '10 minutes'),
  -- The owner's last change, and the last dispatch sent (pg_net's request id, for net._http_response).
  last_changed_at    timestamptz,
  last_dispatched_at timestamptz,
  last_request_id    bigint
);

comment on table private.shelf_publish is
  'Issue #110: whose Library changes send fabkho/regal a repository_dispatch (owner_id, null = off), '
  'and when the last change and dispatch were. One row. The token is the Vault secret github_dispatch_token.';

insert into private.shelf_publish default values;

revoke all on private.shelf_publish from public, anon, authenticated;

-- ------------------------------------------------------------- the dispatch

-- The GitHub token, or null when a dispatch cannot be sent here: no pg_net, no
-- Vault, or no secret named github_dispatch_token. Dynamic SQL, so this compiles
-- and runs where neither extension exists.
create function private.shelf_publish_token()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_token using 'github_dispatch_token';
  return nullif(btrim(v_token), '');
end;
$$;

-- Queues the POST with pg_net (sent after commit) and answers its request id.
create function private.shelf_publish_send(p_token text, p_repository text, p_event_type text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request bigint;
begin
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    into v_request
    using format('https://api.github.com/repos/%s/dispatches', p_repository),
          jsonb_build_object('event_type', p_event_type,
                             'client_payload', jsonb_build_object('source', 'libellus', 'at', now())),
          jsonb_build_object('Authorization', 'Bearer ' || p_token,
                             'Accept', 'application/vnd.github+json',
                             'X-GitHub-Api-Version', '2022-11-28',
                             'User-Agent', 'libellus-shelf-publish',
                             'Content-Type', 'application/json');
  return v_request;
end;
$$;

-- Sends the dispatch the owner's changes are owed, if any: there is a change
-- since the last dispatch, the last one is at least `min_interval` ago, and a
-- dispatch can be sent here. Answers what it did: 'off' (no owner),
-- 'up_to_date', 'debounced', 'unavailable' (no pg_net or no token) or
-- 'dispatched'. Claims the slot with one UPDATE, so two sessions never both send.
create function private.shelf_publish_dispatch()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings private.shelf_publish;
  v_token text;
  v_request bigint;
begin
  select * into v_settings from private.shelf_publish where id;
  if v_settings.owner_id is null then
    return 'off';
  end if;
  if v_settings.last_changed_at is null
     or v_settings.last_changed_at <= v_settings.last_dispatched_at then
    return 'up_to_date';
  end if;
  if v_settings.last_dispatched_at > now() - v_settings.min_interval then
    return 'debounced';
  end if;

  v_token := private.shelf_publish_token();
  if v_token is null then
    return 'unavailable';
  end if;

  update private.shelf_publish
     set last_dispatched_at = now()
   where id
     and last_changed_at > coalesce(last_dispatched_at, '-infinity')
     and coalesce(last_dispatched_at, '-infinity') <= now() - min_interval;
  if not found then
    return 'debounced';
  end if;

  v_request := private.shelf_publish_send(v_token, v_settings.repository, v_settings.event_type);
  update private.shelf_publish set last_request_id = v_request where id;
  return 'dispatched';
end;
$$;

-- A member's Library changed: for the owner, note it and send what is owed.
-- Answers 'not_owner' for everyone else, without writing anything.
create function private.shelf_publish_changed(p_member uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_member is null
     or p_member is distinct from (select owner_id from private.shelf_publish where id) then
    return 'not_owner';
  end if;
  update private.shelf_publish
     set last_changed_at = now()
   where id and last_changed_at is distinct from now();
  return private.shelf_publish_dispatch();
end;
$$;

-- ------------------------------------------------------------------ triggers

-- library_entries: added, removed, Status or own page count changed.
create function private.shelf_publish_on_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select owner_id from private.shelf_publish where id);
begin
  if v_owner is null or v_owner is distinct from coalesce(new.member_id, old.member_id) then
    return null;
  end if;
  begin
    perform private.shelf_publish_changed(v_owner);
  exception when others then
    raise warning 'shelf publish dispatch skipped: %', sqlerrm;
  end;
  return null;
end;
$$;

-- reading_sessions: a read started, finished, abandoned, edited, removed, or its progress.
create function private.shelf_publish_on_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select owner_id from private.shelf_publish where id);
begin
  if v_owner is null or not exists (
    select 1 from public.library_entries e
     where e.id in (new.entry_id, old.entry_id) and e.member_id = v_owner
  ) then
    return null;
  end if;
  begin
    perform private.shelf_publish_changed(v_owner);
  exception when others then
    raise warning 'shelf publish dispatch skipped: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function private.shelf_publish_token() from public, anon, authenticated;
revoke all on function private.shelf_publish_send(text, text, text) from public, anon, authenticated;
revoke all on function private.shelf_publish_dispatch() from public, anon, authenticated;
revoke all on function private.shelf_publish_changed(uuid) from public, anon, authenticated;
revoke all on function private.shelf_publish_on_entry() from public, anon, authenticated;
revoke all on function private.shelf_publish_on_session() from public, anon, authenticated;

create trigger library_entries_shelf_publish
  after insert or update or delete on public.library_entries
  for each row execute function private.shelf_publish_on_entry();

create trigger reading_sessions_shelf_publish
  after insert or update or delete on public.reading_sessions
  for each row execute function private.shelf_publish_on_session();

-- --------------------------------------------------------------- trailing edge

-- Every five minutes, the dispatch a debounced change is still owed. Scheduled
-- where pg_cron is, as purge-synced-writes is; cheap when nothing is owed.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('shelf-publish', '*/5 * * * *', 'select private.shelf_publish_dispatch()');
    exception when others then
      raise notice 'shelf-publish could not be scheduled (%)', sqlerrm;
    end;
  else
    raise notice 'pg_cron is not here: a debounced change waits for the next change or the daily run';
  end if;
end;
$$;
