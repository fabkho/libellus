-- Own covers, part 1: the database (docs/plans/owned-covers.md, §3 and §4; owner decision of 30 Oct 2026).
--
-- The covers of Books that are in a member's Library are to be stored by us (Cloudflare R2, `libellus-covers`), at the
-- sizes the app shows. The database decides what is to be stored, one edge function (`cover-store`, PR 2) stores it.
-- This migration is the database half and nothing else: no function, no bucket, no client reads any of it yet, and
-- the job is OFF (`private.cover_store_settings.enabled = false`) until the owner turns it on.
--
--   public.books.cover_key, cover_widths   our stored copy of `cover_url`: `c/<cover_key>/<w>` for each width
--   private.cover_store_queue              the Books whose cover is to be stored (one row per Book; deleted with it)
--   private.cover_objects                  one row per stored image, made by `cover_store_reserve` before any upload
--   private.cover_store_settings           `enabled` (the off switch) and the function's address, one row
--   private.cover_allowed(url)             (20261027030000) the hosts a cover may be stored from: other hosts stay out in v1
--   private.cover_artwork(url)             the artwork a cover URL is of, whatever size it is asked at
--   private.books_clear_cover_key()        the key follows the picture: another artwork clears key and queue row
--   private.cover_store_reconcile()        queues every Book in a Library with no key and a storable cover
--   private.cover_store_tick()             pg_cron, every minute, while enabled: reconcile, retry, kick
--   private.cover_store_kick(now)          posts `{"action":"run"}` to the function (pg_net, the Vault secret
--                                          `cover_store_token`), only when a row is due and no run holds a lease
--   public.cover_store_claim / _reserve / _done / _failed / _kick
--                                          the function's side (service_role only; the import job's pattern)
--   public.owner_cover_status()            the owner's counts, nothing else
--
-- Why a reconcile and not triggers on `library_entries`/`books`: every way a Book reaches a Library or changes its
-- cover ends with a Book in a Library whose `cover_key` is null, so one statement finds them all, and no path can be
-- forgotten. The first run after the owner turns the job on IS the backfill. The one trigger kept is the key's own:
-- `cover_key` says "and we have it", so when the picture changes it must go (with its queue row, so a `gone` or
-- `failed` Book tries again with its new cover).
--
-- RLS is unchanged: members read `books` as before (two more columns) and never write it. The new tables are in
-- `private`. Members can call none of the functions: the public ones are for service_role only.
--
-- The function's address and secret, once, by the owner (supabase/functions/cover-store/README.md, PR 2):
--
--   update private.cover_store_settings set function_url = 'https://<ref>.supabase.co/functions/v1/cover-store';
--   select vault.create_secret('<the COVER_STORE_TOKEN function secret>', 'cover_store_token');
--   update private.cover_store_settings set enabled = true;   -- the backfill starts with the next tick
--
-- Refusals: not_owner (42501, owner_cover_status), reason_invalid (22023, cover_store_failed).

create schema if not exists private;

-- ----------------------------------------------------------------- books

alter table public.books
  add column cover_key    text,       -- our stored copy of cover_url: c/<cover_key>/<w>
  add column cover_widths smallint[], -- the real widths stored, ascending
  add constraint books_cover_key_format check (cover_key ~ '^[0-9a-f]{32}$'),
  add constraint books_cover_widths_sane check (
    cover_widths is null or (cardinality(cover_widths) between 1 and 6
      and 16 <= all (cover_widths) and 2000 >= all (cover_widths))),
  add constraint books_cover_key_has_widths check ((cover_key is null) = (cover_widths is null));

comment on column public.books.cover_key is
  'Our stored copy of cover_url (R2): the image is c/<cover_key>/<width> for each of cover_widths. Null = not stored (yet). '
  'Written by cover_store_done only; cleared by the trigger when the picture changes.';

-- What the reconcile looks for, and nothing else.
create index books_cover_unstored on public.books (id) where cover_key is null and cover_url is not null;

-- ---------------------------------------------------------------- tables

create table private.cover_store_settings (
  id              boolean primary key default true check (id),
  -- The off switch: the tick and the kick do nothing while it is false.
  enabled         boolean not null default false,
  -- The function's address; null = off (nothing is sent; the local stack runs the function by hand).
  function_url    text check (function_url ~ '^https?://[^[:space:]]+$'),
  -- The tick does not kick again sooner than this after the last kick (a run's own kick is never held back).
  min_interval    interval not null default interval '50 seconds',
  last_kick_at    timestamptz,
  last_request_id bigint
);

comment on table private.cover_store_settings is
  'Whether covers are stored at all (enabled, false until the owner turns it on) and where the cover-store edge function '
  'is (null = off). One row. Its token is the Vault secret cover_store_token.';

insert into private.cover_store_settings default values;

create table private.cover_store_queue (
  book_id      uuid primary key references public.books (id) on delete cascade,
  source_url   text not null,
  state        text not null default 'queued' check (state in ('queued', 'leased', 'failed', 'gone', 'unsupported')),
  attempts     integer not null default 0,
  due_at       timestamptz not null default now(),
  leased_by    text,
  leased_until timestamptz,
  last_error   text,
  enqueued_at  timestamptz not null default now()
);

comment on table private.cover_store_queue is
  'Books whose cover is to be stored. queued/leased are work; failed is tried again weekly; gone and unsupported are '
  'terminal until the Book''s cover changes (the trigger deletes the row then).';

create index cover_store_queue_due on private.cover_store_queue (due_at) where state in ('queued', 'failed');
create index cover_store_queue_leased on private.cover_store_queue (leased_until) where state = 'leased';

create table private.cover_objects (
  key          text primary key check (key ~ '^[0-9a-f]{32}$'),
  widths       smallint[],
  content_type text,
  bytes        bigint,
  stored_at    timestamptz,
  -- Set when no Book uses the key any more (GC, PR 6); the object goes 30 days later. `deleting_at`: GC is deleting it.
  orphaned_at  timestamptz,
  deleting_at  timestamptz
);

comment on table private.cover_objects is
  'One row per stored image (c/<key>/<width> for each width), made by cover_store_reserve before any upload. GC works from it.';

alter table private.cover_store_settings enable row level security;
alter table private.cover_store_queue enable row level security;
alter table private.cover_objects enable row level security;
revoke all on private.cover_store_settings from public, anon, authenticated;
revoke all on private.cover_store_queue from public, anon, authenticated;
revoke all on private.cover_objects from public, anon, authenticated;

-- --------------------------------------------------------- the artwork

-- The database twin of `artworkOf` in web/app/utils/cover.ts: the artwork a cover URL is of, whatever size it is asked
-- at. Apple's `/<w>x<h>bb.<ext>` and Open Library's `-S/-M/-L` and `?default=false` are only a size.
create function private.cover_artwork(p_url text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_url is null then null
    when p_url ~* '^https://covers\.openlibrary\.org/' then
      regexp_replace(regexp_replace(p_url, '-[SML]\.jpg(?=\?|$)', '-M.jpg'), '[?&]default=false$', '')
    else
      regexp_replace(p_url, '/\d+x\d+bb\.(jpg|jpeg|png|webp)$', '/1x1bb.jpg')
  end
$$;

-- The key follows the picture: another artwork clears the stored copy and its queue row (a `gone`/`failed` Book then
-- tries again with its new cover on the next reconcile). Its own write (cover_key, widths, a filled thumbhash) never
-- fires it: the trigger is on `cover_url` only, and its WHEN keeps same-value writes (the catalogue check and
-- fill_book_covers write cover_url on every check) and Apple's size changes from clearing every key.
create function private.books_clear_cover_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.cover_key := null;
  new.cover_widths := null;
  delete from private.cover_store_queue where book_id = new.id;
  return new;
end
$$;

create trigger books_cover_key_follows_cover
before update of cover_url on public.books
for each row
when (private.cover_artwork(old.cover_url) is distinct from private.cover_artwork(new.cover_url))
execute function private.books_clear_cover_key();

-- ------------------------------------------------------------ reconcile

-- Every Book in a Library with no stored copy and a cover we may store. Returns how many were queued.
create function private.cover_store_reconcile()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into private.cover_store_queue (book_id, source_url)
  select b.id, b.cover_url
    from public.books b
   where b.cover_key is null
     and b.cover_url is not null
     and private.cover_allowed(b.cover_url)
     and exists (select 1 from public.library_entries e where e.book_id = b.id)
  on conflict (book_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- --------------------------------------------------------------- the kick

-- Whether a row is due: queued and its time has come, or leased and the lease ran out (a dead runner).
create function private.cover_store_due()
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from private.cover_store_queue q
     where (q.state = 'queued' and q.due_at <= now())
        or (q.state = 'leased' and q.leased_until < now())
  )
$$;

-- Calls the function for the next run when a row is due. One run at a time: nothing is sent while any lease is valid.
-- `p_now`: a run just ended (self-chaining), not held back by `min_interval`.
-- Answers 'off', 'idle', 'busy', 'debounced', 'unavailable' or 'sent'.
create function private.cover_store_kick(p_now boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings private.cover_store_settings;
  v_token text;
  v_request bigint;
begin
  select * into v_settings from private.cover_store_settings where id;
  if not v_settings.enabled or v_settings.function_url is null then return 'off'; end if;
  if not private.cover_store_due() then return 'idle'; end if;
  if exists (select 1 from private.cover_store_queue q where q.state = 'leased' and q.leased_until >= now()) then
    return 'busy';
  end if;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return 'unavailable';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_token using 'cover_store_token';
  if nullif(btrim(v_token), '') is null then return 'unavailable'; end if;

  update private.cover_store_settings
     set last_kick_at = now()
   where id and (p_now or coalesce(last_kick_at, '-infinity') <= now() - min_interval);
  if not found then return 'debounced'; end if;

  -- pg_net sends after this transaction commits and waits in the background: as long as a run may take.
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 150000)'
    into v_request
    using v_settings.function_url,
          jsonb_build_object('action', 'run'),
          jsonb_build_object('Authorization', 'Bearer ' || btrim(v_token), 'Content-Type', 'application/json');
  update private.cover_store_settings set last_request_id = v_request where id;
  return 'sent';
end
$$;

-- pg_cron, every minute: does nothing while the job is off. Failed rows are tried again weekly (once, then a week
-- again: attempts stay at the last step), the reconcile queues what is new, and a run is kicked when a row is due.
create function private.cover_store_tick()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not coalesce((select enabled from private.cover_store_settings where id), false) then return 'off'; end if;
  update private.cover_store_queue
     set state = 'queued', attempts = 5
   where state = 'failed' and due_at <= now();
  perform private.cover_store_reconcile();
  return private.cover_store_kick(false);
end
$$;

-- Rotating COVER_KEY_SECRET (docs/plans/owned-covers.md, runbook): every Book loses its stored copy and is queued
-- again by the reconcile under its new key; `cover_objects` stays, so the old objects become orphans for GC.
create function private.cover_store_rekey()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.books set cover_key = null, cover_widths = null where cover_key is not null;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- ------------------------------------------------- the function's side

-- Leases up to p_limit due Books to this runner for 170 s (longer than a function lives, so a dead runner's lease always
-- runs out). A Book no longer in any Library is dropped. A lease that ran out counts as an attempt (a runner killed by
-- the CPU limit); past the last step the row is `failed`. The runner id must be unique per invocation.
-- Answers the Books: where the cover is, how often it was tried, and whether the Book lacks a thumbhash / colours.
create function public.cover_store_claim(p_runner text, p_limit integer default 8)
returns table (book_id uuid, source_url text, attempts integer, needs_thumbhash boolean, needs_colours boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  delete from private.cover_store_queue q
   where q.state in ('queued', 'leased')
     and not exists (select 1 from public.library_entries e where e.book_id = q.book_id);

  update private.cover_store_queue q
     set attempts = q.attempts + 1,
         state = case when q.attempts + 1 > 5 then 'failed' else 'queued' end,
         due_at = case when q.attempts + 1 > 5 then now() + interval '7 days' else now() end,
         leased_by = null, leased_until = null, last_error = 'lease_expired'
   where q.state = 'leased' and q.leased_until < now();

  return query
    with picked as (
      select q.book_id
        from private.cover_store_queue q
       where q.state = 'queued' and q.due_at <= now()
       order by q.due_at, q.enqueued_at
       limit least(greatest(coalesce(p_limit, 8), 1), 20)
       for update skip locked
    ), leased as (
      update private.cover_store_queue q
         set state = 'leased', leased_by = p_runner, leased_until = now() + interval '170 seconds',
             source_url = b.cover_url
        from picked p
        join public.books b on b.id = p.book_id
       where q.book_id = p.book_id and b.cover_url is not null
      returning q.book_id, q.source_url, q.attempts, b.cover_thumbhash, b.cover_dominant, b.cover_secondary
    )
    select l.book_id, l.source_url, l.attempts, l.cover_thumbhash is null,
           (l.cover_dominant is null and l.cover_secondary is null)
      from leased l;
end
$$;

-- Reserves a key before anything is uploaded to it: makes its `cover_objects` row, or clears its `orphaned_at`.
-- False while GC is deleting that image (`deleting_at` set): the caller books the row again in 10 minutes
-- (cover_store_failed 'deleting'), after GC is done, and uploads afresh. Reservation and GC's claim lock the same row,
-- so one waits for the other.
create function public.cover_store_reserve(p_key text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  insert into private.cover_objects as o (key) values (p_key)
  on conflict (key) do update set orphaned_at = null where o.deleting_at is null
  returning o.key into v_key;
  return v_key is not null;
end
$$;

-- The copy is stored: a compare-and-swap, written only if the Book's artwork is still that of `p_source_url` (a cover
-- changed meanwhile had its row deleted by the trigger and is found again by the next reconcile). A Book done twice
-- changes nothing. The thumbhash and colours go only into empty ones; the key's `cover_objects` row learns what was
-- stored. Answers true when the Book has the copy (now or already), false when the cover changed (or the Book is gone).
create function public.cover_store_done(
  p_book uuid, p_source_url text, p_key text, p_widths integer[], p_bytes bigint,
  p_content_type text default null, p_thumbhash text default null,
  p_dominant text default null, p_secondary text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_widths smallint[] := array(select distinct w::smallint from unnest(p_widths) w order by 1);
  v_written uuid;
begin
  -- The object first (its row exists since the reservation), so a Book never points at a row that knows nothing.
  update private.cover_objects
     set widths = v_widths, bytes = p_bytes, content_type = p_content_type, stored_at = now(), orphaned_at = null
   where key = p_key and deleting_at is null;
  if not found then return false; end if;

  update public.books b
     set cover_key = p_key,
         cover_widths = v_widths,
         cover_thumbhash = coalesce(b.cover_thumbhash, nullif(btrim(p_thumbhash), '')),
         cover_dominant = case when b.cover_dominant is null and b.cover_secondary is null
                               then lower(nullif(btrim(p_dominant), '')) else b.cover_dominant end,
         cover_secondary = case when b.cover_dominant is null and b.cover_secondary is null
                                then lower(nullif(btrim(p_secondary), '')) else b.cover_secondary end
   where b.id = p_book
     and private.cover_artwork(b.cover_url) = private.cover_artwork(p_source_url)
     and b.cover_key is distinct from p_key
  returning b.id into v_written;

  if v_written is not null then
    delete from private.cover_store_queue where book_id = p_book;
    return true;
  end if;
  -- Nothing written: done before (the same key is there already), or the cover changed meanwhile.
  return exists (select 1 from public.books b where b.id = p_book and b.cover_key = p_key
                    and private.cover_artwork(b.cover_url) = private.cover_artwork(p_source_url));
end
$$;

-- A try failed, for the runner holding the lease (false when it no longer does). By reason:
--   throttled, deleting       booked again in 10 minutes, no attempt counted (Open Library's 403; GC is deleting the key)
--   gone, unsupported_url     terminal until the cover changes
--   timeout, host_error, not_image, too_large, r2_error
--                             booked again after 1 min, 10 min, 1 h, 6 h, 24 h, then `failed` (tried again weekly)
create function public.cover_store_failed(p_book uuid, p_runner text, p_reason text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_found uuid;
begin
  if p_reason is null or p_reason not in ('throttled', 'deleting', 'gone', 'unsupported_url',
                                          'timeout', 'host_error', 'not_image', 'too_large', 'r2_error') then
    raise exception 'reason_invalid' using errcode = '22023';
  end if;

  if p_reason in ('throttled', 'deleting') then
    update private.cover_store_queue
       set state = 'queued', due_at = now() + interval '10 minutes', leased_by = null, leased_until = null, last_error = p_reason
     where book_id = p_book and state = 'leased' and leased_by = p_runner
    returning book_id into v_found;
  elsif p_reason = 'gone' then
    update private.cover_store_queue
       set state = 'gone', leased_by = null, leased_until = null, last_error = p_reason
     where book_id = p_book and state = 'leased' and leased_by = p_runner
    returning book_id into v_found;
  elsif p_reason = 'unsupported_url' then
    update private.cover_store_queue
       set state = 'unsupported', leased_by = null, leased_until = null, last_error = p_reason
     where book_id = p_book and state = 'leased' and leased_by = p_runner
    returning book_id into v_found;
  else
    update private.cover_store_queue
       set attempts = attempts + 1,
           state = case when attempts + 1 > 5 then 'failed' else 'queued' end,
           due_at = now() + case attempts + 1
                              when 1 then interval '1 minute' when 2 then interval '10 minutes' when 3 then interval '1 hour'
                              when 4 then interval '6 hours' when 5 then interval '24 hours' else interval '7 days' end,
           leased_by = null, leased_until = null, last_error = p_reason
     where book_id = p_book and state = 'leased' and leased_by = p_runner
    returning book_id into v_found;
  end if;
  return v_found is not null;
end
$$;

-- A run that leaves rows due kicks the next one at once.
create function public.cover_store_kick(p_now boolean default true)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select private.cover_store_kick(p_now)
$$;

-- --------------------------------------------------------- the owner

-- Counts only, for the instance's owner (not_owner for anyone else). Over the Books in a Library with a cover.
create function public.owner_cover_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_with_cover integer;
  v_stored integer;
  v_failed integer;
  v_bytes bigint;
  v_warnings text[] := '{}';
  v_result jsonb;
begin
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  select count(*), count(*) filter (where b.cover_key is not null)
    into v_with_cover, v_stored
    from public.books b
   where b.cover_url is not null
     and exists (select 1 from public.library_entries e where e.book_id = b.id);

  select count(*) into v_failed from private.cover_store_queue where state = 'failed';
  select coalesce(sum(bytes), 0)::bigint into v_bytes from private.cover_objects;

  if v_bytes > 5368709120::bigint then v_warnings := array_append(v_warnings, 'stored_bytes_over_5gb'); end if;
  if v_with_cover > 0 and v_failed * 20 > v_with_cover then v_warnings := array_append(v_warnings, 'failed_over_5_percent'); end if;

  select jsonb_build_object(
    'enabled', coalesce((select enabled from private.cover_store_settings where id), false),
    'with_cover', v_with_cover,
    'stored', v_stored,
    'queued', (select count(*) from private.cover_store_queue
                where state = 'queued' and coalesce(last_error, '') not in ('throttled', 'deleting')),
    'leased', (select count(*) from private.cover_store_queue where state = 'leased'),
    'throttled', (select count(*) from private.cover_store_queue
                   where state = 'queued' and last_error in ('throttled', 'deleting')),
    'failed', v_failed,
    'failed_by_reason', coalesce((select jsonb_object_agg(reason, n)
                                    from (select coalesce(last_error, 'unknown') as reason, count(*) as n
                                            from private.cover_store_queue where state = 'failed' group by 1) f), '{}'),
    'gone', (select count(*) from private.cover_store_queue where state = 'gone'),
    'unsupported', (select count(*) from private.cover_store_queue where state = 'unsupported'),
    -- Storable and not queued yet: the next tick's reconcile takes them.
    'unqueued', (select count(*) from public.books b
                  where b.cover_key is null and b.cover_url is not null and private.cover_allowed(b.cover_url)
                    and exists (select 1 from public.library_entries e where e.book_id = b.id)
                    and not exists (select 1 from private.cover_store_queue q where q.book_id = b.id)),
    -- Other hosts: not stored in v1.
    'not_storable', (select count(*) from public.books b
                      where b.cover_url is not null and not private.cover_allowed(b.cover_url)
                        and exists (select 1 from public.library_entries e where e.book_id = b.id)),
    'objects', (select count(*) from private.cover_objects),
    'bytes', v_bytes,
    'orphaned', (select count(*) from private.cover_objects where orphaned_at is not null),
    'deleting', (select count(*) from private.cover_objects where deleting_at is not null),
    'warnings', to_jsonb(v_warnings)
  ) into v_result;
  return v_result;
end
$$;

-- -------------------------------------------------------------- grants

revoke all on function private.cover_artwork(text) from public, anon, authenticated;
revoke all on function private.books_clear_cover_key() from public, anon, authenticated;
revoke all on function private.cover_store_reconcile() from public, anon, authenticated;
revoke all on function private.cover_store_due() from public, anon, authenticated;
revoke all on function private.cover_store_kick(boolean) from public, anon, authenticated;
revoke all on function private.cover_store_tick() from public, anon, authenticated;
revoke all on function private.cover_store_rekey() from public, anon, authenticated;

revoke all on function public.cover_store_claim(text, integer) from public, anon, authenticated;
revoke all on function public.cover_store_reserve(text) from public, anon, authenticated;
revoke all on function public.cover_store_done(uuid, text, text, integer[], bigint, text, text, text, text) from public, anon, authenticated;
revoke all on function public.cover_store_failed(uuid, text, text) from public, anon, authenticated;
revoke all on function public.cover_store_kick(boolean) from public, anon, authenticated;
grant execute on function public.cover_store_claim(text, integer) to service_role;
grant execute on function public.cover_store_reserve(text) to service_role;
grant execute on function public.cover_store_done(uuid, text, text, integer[], bigint, text, text, text, text) to service_role;
grant execute on function public.cover_store_failed(uuid, text, text) to service_role;
grant execute on function public.cover_store_kick(boolean) to service_role;

revoke all on function public.owner_cover_status() from public, anon;
grant execute on function public.owner_cover_status() to authenticated;

-- ------------------------------------------------------------- pg_cron

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('cover-store-tick', '* * * * *', 'select private.cover_store_tick()');
    exception when others then
      raise warning 'cover-store-tick could not be scheduled (%): covers are not stored until it is (it does nothing while private.cover_store_settings.enabled is false)', sqlerrm;
    end;
  else
    raise warning 'pg_cron is not here: covers are not queued or stored (enable pg_cron, then schedule cover-store-tick: select cron.schedule(''cover-store-tick'', ''* * * * *'', ''select private.cover_store_tick()''))';
  end if;
end;
$$;
