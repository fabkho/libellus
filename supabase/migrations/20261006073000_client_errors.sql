-- A small log of the errors the app meets on members' devices.
--
-- Server-side errors show in Supabase's logs; what goes wrong in the browser
-- (an exception, a write that waited offline and was finally refused, the
-- owner's shelf failing to load, a chunk that is gone after a deploy) is seen by
-- nobody. No third-party service (no Sentry, no PostHog): the app reports those
-- errors here itself (web/app/data/errorLog.ts), and the owner reads them in the
-- dashboard (docs/OPERATIONS.md, Client errors).
--
--   private.client_errors      one row per error, or per burst of the same one
--   log_client_error(...)      the only way in: checked, scrubbed, capped, rate-limited
--   private.purge_client_errors()  deletes rows older than 30 days, daily by pg_cron
--
-- What a row holds is technical only: the kind, the message and the stack (both
-- scrubbed of e-mail addresses and of the query and fragment of every URL, and
-- cut to 1 kB and 8 kB), the route's path (never its query), the build, a short
-- browser name, whether the app runs installed or in a tab, whether the device
-- was online, how often it happened, and the member who reported it (null when
-- signed out). The client leaves out book titles, notes and search terms in what
-- it reports itself, and scrubs the same way before sending; this repeats the
-- scrubbing so a native client or an old build cannot store more.
--
-- Signed-out devices may report too (`anon`): the sign-in, sign-up and verify
-- screens and a deploy's missing chunks meet people before or without a session,
-- and an invite flow that breaks is exactly what nobody would otherwise see. The
-- anon key is public, so anonymous reports are limited harder: by a key made
-- from the caller's address (a salted SHA-256 of it; the address itself is never
-- stored) and, because a forwarded-for header can be made up, by a cap on all
-- anonymous reports together.
--
-- Limits, per caller and rolling hour, counted in rows:
--   a member                30
--   one signed-out address  10
--   all signed-out callers  100
-- The same error again (same caller, kind, message and stack) within 10 minutes
-- of its row's first report adds to that row's `count` instead of making a new
-- row, and is never refused. A report over a limit is dropped quietly
-- ('dropped'): the device has nothing to do about it and must not retry.
--
-- Refusals (stable messages, the client maps them like the library's):
--   kind_invalid      a kind the table does not know (its check lists them)
--   message_missing   no message, or only blanks
--
-- Members cannot read, change or delete the rows: the table lives in `private`,
-- which the API does not expose and the API roles cannot use. A member's rows go
-- with her account (`on delete cascade`, delete_my_account).

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.client_errors (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  -- The last report folded into this row (the end of a burst).
  last_seen_at timestamptz not null default now(),
  user_id      uuid references auth.users (id) on delete cascade,
  -- Whose limits it counts against: 'member:<id>' or 'anon:<salted hash of the address>'.
  caller_key   text not null,
  kind         text not null
               check (kind in ('error', 'unhandledrejection', 'vue', 'chunk', 'outbox', 'shelf')),
  message      text not null check (char_length(message) between 1 and 1000),
  stack        text check (char_length(stack) <= 8000),
  route        text check (char_length(route) <= 200),
  app_version  text check (char_length(app_version) <= 64),
  user_agent   text check (char_length(user_agent) <= 200),
  standalone   boolean,
  online       boolean,
  count        integer not null default 1 check (count >= 1)
);

create index client_errors_caller_created_at on private.client_errors (caller_key, created_at);
create index client_errors_created_at on private.client_errors (created_at);
-- The foreign key's own index (a member's rows go with her account).
create index client_errors_user_id on private.client_errors (user_id);

comment on table private.client_errors is
  'Errors the app met on devices (JS exceptions, refused offline writes, the shelf, missing chunks), '
  'technical details only, kept 30 days. Written only by log_client_error; read in the dashboard (docs/OPERATIONS.md).';

alter table private.client_errors enable row level security;
revoke all on private.client_errors from public, anon, authenticated;

-- The salt for the signed-out callers' keys: made once, here, readable by nobody but the owner of the schema.
create table private.client_error_salt (
  id   boolean primary key default true check (id),
  salt text not null default (gen_random_uuid()::text || gen_random_uuid()::text)
);
insert into private.client_error_salt default values;
alter table private.client_error_salt enable row level security;
revoke all on private.client_error_salt from public, anon, authenticated;

-- ------------------------------------------------------------------ scrubbing

-- Leaves out of a text what must not be kept: e-mail addresses, and the query
-- and fragment of every URL in it (search terms, tokens, share targets). A
-- stack frame's line and column after a query (`x.js?v=1a2b:10:4`, Vite in
-- development) stay.
create function private.scrub_client_text(p_text text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select regexp_replace(
           regexp_replace(p_text, '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[email]', 'g'),
           '([a-z][a-z0-9+.-]*://[^[:space:]?#"''<>()]*)[?#][^[:space:]"''<>()]*?((:[0-9]+){0,2})(?=[[:space:]"''<>()]|$)',
           '\1\2', 'gi')
$$;

revoke all on function private.scrub_client_text(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ the write

create function public.log_client_error(
  p_kind        text,
  p_message     text,
  p_stack       text default null,
  p_route       text default null,
  p_app_version text default null,
  p_user_agent  text default null,
  p_standalone  boolean default null,
  p_online      boolean default null,
  p_count       integer default 1
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_member  uuid := auth.uid();
  v_headers jsonb;
  v_address text;
  v_caller  text;
  v_message text;
  v_stack   text;
  v_route   text;
  v_count   integer := least(greatest(coalesce(p_count, 1), 1), 1000);
  v_row     bigint;
  v_recent  bigint;
  -- Rows a caller may add in an hour: a member, one signed-out address.
  v_limit   integer := 30;
begin
  if p_kind is null or p_kind not in ('error', 'unhandledrejection', 'vue', 'chunk', 'outbox', 'shelf') then
    raise exception 'kind_invalid' using errcode = '22023';
  end if;

  v_message := left(private.scrub_client_text(btrim(left(coalesce(p_message, ''), 4000))), 1000);
  if v_message = '' then
    raise exception 'message_missing' using errcode = '22023';
  end if;
  v_stack := nullif(left(private.scrub_client_text(left(p_stack, 32000)), 8000), '');
  -- The path only: no query, no fragment, nothing that is not a path.
  v_route := left(split_part(split_part(btrim(p_route), '?', 1), '#', 1), 200);
  if v_route !~ '^/' then
    v_route := null;
  end if;

  if v_member is not null then
    v_caller := 'member:' || v_member;
  else
    v_limit := 10;
    -- PostgREST hands the request's headers over as a setting. The first address
    -- of x-forwarded-for is the client's, as the platform's proxy saw it.
    v_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
    v_address := coalesce(
      nullif(btrim(v_headers ->> 'cf-connecting-ip'), ''),
      nullif(btrim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''),
      nullif(btrim(v_headers ->> 'x-real-ip'), ''),
      'unknown');
    v_caller := 'anon:' || left(encode(sha256(convert_to(
      v_address || (select salt from private.client_error_salt), 'UTF8')), 'hex'), 32);
  end if;

  -- One report of a caller at a time, so two at once cannot both slip under a limit or both make the row.
  perform pg_advisory_xact_lock(hashtext('log_client_error:' || v_caller));

  -- The same error again shortly after: counted on its row.
  update private.client_errors e
     set count = least(e.count::bigint + v_count, 2147483647)::integer,
         last_seen_at = now()
   where e.id = (
     select c.id from private.client_errors c
      where c.caller_key = v_caller
        and c.created_at > now() - interval '10 minutes'
        and c.kind = p_kind
        and c.message = v_message
        and c.stack is not distinct from v_stack
      order by c.created_at desc
      limit 1)
  returning e.id into v_row;
  if v_row is not null then
    return 'counted';
  end if;

  select count(*) into v_recent from private.client_errors c
   where c.caller_key = v_caller and c.created_at > now() - interval '1 hour';
  if v_recent >= v_limit then
    return 'dropped';
  end if;
  if v_member is null then
    perform pg_advisory_xact_lock(hashtext('log_client_error:anon'));
    select count(*) into v_recent from private.client_errors c
     where c.user_id is null and c.caller_key like 'anon:%' and c.created_at > now() - interval '1 hour';
    if v_recent >= 100 then
      return 'dropped';
    end if;
  end if;

  insert into private.client_errors
    (user_id, caller_key, kind, message, stack, route, app_version, user_agent, standalone, online, count)
  values
    (v_member, v_caller, p_kind, v_message, v_stack, v_route,
     nullif(left(btrim(p_app_version), 64), ''), nullif(left(btrim(p_user_agent), 200), ''),
     p_standalone, p_online, v_count);
  return 'logged';
end;
$$;

comment on function public.log_client_error(text, text, text, text, text, text, boolean, boolean, integer) is
  'Records an error the app met on the device (private.client_errors): scrubbed, capped, the same error within '
  '10 minutes counted on one row, at most 30 rows an hour per member (10 per signed-out address, 100 for all '
  'signed-out callers). Answers logged, counted or dropped. Refuses kind_invalid and message_missing.';

revoke all on function public.log_client_error(text, text, text, text, text, text, boolean, boolean, integer) from public;
grant execute on function public.log_client_error(text, text, text, text, text, text, boolean, boolean, integer)
  to anon, authenticated;

-- -------------------------------------------------------------- the retention

create function private.purge_client_errors()
returns bigint
language sql
security invoker
set search_path = pg_catalog
as $$
  with gone as (
    delete from private.client_errors
    where created_at < now() - interval '30 days'
    returning 1
  )
  select count(*) from gone;
$$;

comment on function private.purge_client_errors() is
  'Deletes the client_errors rows older than 30 days and answers how many. Run daily by pg_cron; not callable by members.';

revoke all on function private.purge_client_errors() from public, anon, authenticated;

-- Scheduled like purge-synced-writes (20261005094846_synced_writes_cleanup.sql):
-- only where pg_cron is, so the migration also runs on a Postgres without it.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
      begin
        create extension pg_cron;
      exception when others then
        raise notice 'pg_cron could not be enabled (%): private.purge_client_errors() is not scheduled', sqlerrm;
      end;
    else
      raise notice 'pg_cron is not available here: private.purge_client_errors() is not scheduled';
    end if;
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      -- By name: scheduling again replaces the job instead of doubling it.
      perform cron.schedule('purge-client-errors', '45 3 * * *', 'select private.purge_client_errors()');
    exception when others then
      raise notice 'pg_cron is there but the job could not be scheduled (%): private.purge_client_errors() is not scheduled', sqlerrm;
    end;
  end if;
end;
$$;
