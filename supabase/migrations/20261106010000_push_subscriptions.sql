-- "Import done" as a Web Push (proposal #329: the member is told she can close BetterReads; she is told when it is done).
--
--   public.push_subscriptions      one browser (or installed app) of a member that agreed to be told: its Push service address
--                                  and the keys a message to it is encrypted with (RFC 8291). Own rows only.
--   public.save_push_subscription  the app saves what `PushManager.subscribe` gave it (the one write a member makes here)
--   public.delete_push_subscription the app drops it (she turned it off, or the browser lost it)
--   public.import_jobs.notified_at  one push per job: set by whoever sends it, once
--
-- Sending is the `import-job` edge function's `notify` action (supabase/functions/import-job/push.ts): the database kicks it
-- through pg_net the moment a job turns `done` or `failed` (a trigger: those states are set in several places, the release, the
-- stall check, the claim), exactly like the import's own kick (`private.import_job_kick`: the same address, the same Vault
-- secret). A kick that did not get through is repeated by pg_cron's `import-job-push` (every minute, jobs ended in the last
-- 15 minutes): the function claims a job's push atomically (`import_job_claim_push`), so a second kick sends nothing.
--
-- The members' side is closed: she reads her own rows (RLS) and writes through the two functions; the function that sends is
-- the service role.

-- ------------------------------------------------------------------ table

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references auth.users (id) on delete cascade,
  -- The Push service's address for this browser (FCM, Mozilla autopush, Apple's web.push.apple.com): https, unguessable.
  endpoint    text not null unique check (endpoint ~ '^https://[^[:space:]]+$' and char_length(endpoint) <= 1000),
  -- The browser's public key (an uncompressed P-256 point) and its auth secret, both base64url without padding.
  p256dh      text not null check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  auth        text not null check (auth ~ '^[A-Za-z0-9_-]{22}$'),
  -- The words of the notification, the app's language when she agreed to it.
  locale      text not null default 'en' check (locale in ('en', 'de')),
  created_at  timestamptz not null default now(),
  -- The last time the Push service took a message for it.
  last_ok_at  timestamptz
);

create index push_subscriptions_member on public.push_subscriptions (member_id);

comment on table public.push_subscriptions is
  'A member''s browser that agreed to Web Push (supabase/functions/import-job/README.md): the Push service address and the '
  'keys its messages are encrypted with. Own rows readable; written through save_/delete_push_subscription; the sender '
  '(service role) updates last_ok_at and deletes the ones the Push service says are gone (404/410).';

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select on public.push_subscriptions to authenticated;
grant select, update, delete on public.push_subscriptions to service_role;

create policy push_subscriptions_own on public.push_subscriptions for select to authenticated
  using (member_id = (select auth.uid()));

-- ------------------------------------------------------------ the member

-- Saves this browser's subscription as hers. The endpoint is the browser's: when it was somebody else's (another member
-- signed in here before), it is hers now. At most 10 a member (the oldest go): browsers a member no longer uses are never
-- told to us, the Push service says so with a 410 the first time we write to them.
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_locale text default 'en')
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  insert into public.push_subscriptions (member_id, endpoint, p256dh, auth, locale)
  values (v_member, p_endpoint, p_p256dh, p_auth, coalesce(p_locale, 'en'))
  on conflict (endpoint) do update
     set member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth, locale = excluded.locale,
         created_at = now(), last_ok_at = null;
  delete from public.push_subscriptions
   where member_id = v_member
     and id in (select id from public.push_subscriptions where member_id = v_member order by created_at desc, id offset 10);
end
$$;

-- Drops this browser's subscription (hers only). Answers whether there was one.
create function public.delete_push_subscription(p_endpoint text)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_gone integer;
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  delete from public.push_subscriptions where member_id = v_member and endpoint = p_endpoint;
  get diagnostics v_gone = row_count;
  return v_gone > 0;
end
$$;

-- ------------------------------------------------------------ one push per job

alter table public.import_jobs add column notified_at timestamptz;

comment on column public.import_jobs.notified_at is
  'When the push for the job''s end (done or failed) was claimed: one push per job (import_job_claim_push).';

-- Claims the job's push: answers what to tell, once. Null when the job is not over (or ended cancelled), or its push was claimed
-- already. `kept` is the count the app's own words use (the rows that were in her Library before, the ones the device left out too).
create function public.import_job_claim_push(p_job uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.import_jobs;
begin
  update public.import_jobs
     set notified_at = now()
   where id = p_job and state in ('done', 'failed') and notified_at is null
  returning * into v_job;
  if v_job.id is null then return null; end if;
  return jsonb_build_object(
    'member_id', v_job.member_id,
    'state', v_job.state,
    'added', v_job.added,
    'kept', v_job.kept + v_job.already,
    'failed', v_job.failed
  );
end
$$;

-- Gives the claim back: the push service could not be reached for any of her browsers, so the next kick tries again.
create function public.import_job_unclaim_push(p_job uuid)
returns void
language sql
volatile
security definer
set search_path = pg_catalog, public
as $$
  update public.import_jobs set notified_at = null where id = p_job and state in ('done', 'failed')
$$;

-- ------------------------------------------------------------ the kick

-- Asks the `import-job` function to send a job's push, through pg_net (after this transaction commits). Answers 'off' (no
-- function address: the local stack, CI), 'idle' (she has no browser to tell), 'unavailable' (no pg_net or no Vault secret) or 'sent'.
create function private.import_push_kick(p_job uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings private.import_job_settings;
  v_token text;
  v_request bigint;
begin
  select * into v_settings from private.import_job_settings where id;
  if v_settings.function_url is null then return 'off'; end if;
  if not exists (
    select 1 from public.import_jobs j join public.push_subscriptions s on s.member_id = j.member_id where j.id = p_job
  ) then return 'idle'; end if;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return 'unavailable';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_token using 'import_job_token';
  if nullif(btrim(v_token), '') is null then return 'unavailable'; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 30000)'
    into v_request
    using v_settings.function_url,
          jsonb_build_object('action', 'notify', 'job', p_job),
          jsonb_build_object('Authorization', 'Bearer ' || btrim(v_token), 'Content-Type', 'application/json');
  return 'sent';
end
$$;

-- A job turned done or failed: tell her. Whatever goes wrong here never costs the job its state.
create function private.import_job_ended()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform private.import_push_kick(new.id);
  exception when others then
    raise warning 'import_job_ended: the push for % was not kicked: %', new.id, sqlerrm;
  end;
  return null;
end
$$;

create trigger import_jobs_ended
  after update of state on public.import_jobs
  for each row
  when (new.state in ('done', 'failed') and old.state is distinct from new.state and new.notified_at is null)
  execute function private.import_job_ended();

-- The safety net: a kick that did not get through (the function was down, its claim was given back) is repeated for the
-- jobs that ended in the last 15 minutes, a minute after they ended.
create function private.import_push_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job uuid;
  v_count integer := 0;
begin
  for v_job in
    select j.id
      from public.import_jobs j
     where j.state in ('done', 'failed') and j.notified_at is null
       and j.finished_at between now() - interval '15 minutes' and now() - interval '1 minute'
     order by j.finished_at
     limit 20
  loop
    if private.import_push_kick(v_job) = 'sent' then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end
$$;

-- ------------------------------------------------------------------ grants

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;

revoke all on function public.import_job_claim_push(uuid) from public, anon, authenticated;
revoke all on function public.import_job_unclaim_push(uuid) from public, anon, authenticated;
grant execute on function public.import_job_claim_push(uuid) to service_role;
grant execute on function public.import_job_unclaim_push(uuid) to service_role;

revoke all on function private.import_push_kick(uuid) from public, anon, authenticated;
revoke all on function private.import_job_ended() from public, anon, authenticated;
revoke all on function private.import_push_sweep() from public, anon, authenticated;

-- ------------------------------------------------------------- pg_cron

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('import-job-push', '* * * * *', 'select private.import_push_sweep()');
    exception when others then
      raise warning 'import-job-push could not be scheduled (%): a push whose kick did not get through is not repeated', sqlerrm;
    end;
  else
    raise warning 'pg_cron is not here: a push whose kick did not get through is not repeated (enable pg_cron, then schedule import-job-push: see supabase/functions/import-job/README.md)';
  end if;
end;
$$;
