-- synced_writes does not grow forever.
--
-- `sync_write` (20261004202145) records every write a device sent after it waited
-- offline, by the id the device gave it, so a second send of the same write is
-- answered instead of applied again. A row is only ever read in the minutes or
-- days between the first send and its repeat; after that it is dead weight. It
-- already drops a member's rows older than 60 days when she syncs, but a member
-- who stops syncing leaves hers behind. This sweeps every member's rows once a day:
--
--   purge_synced_writes()   deletes the rows older than 30 days, answers how many
--
-- scheduled with pg_cron ('purge-synced-writes', daily at 03:30 UTC). A write does
-- not wait on a device for 30 days, and the repeat of a lost answer comes within
-- the hour.
--
-- pg_cron is a Supabase extension, not part of every Postgres: the local stack and
-- the hosted project have it, a plain Postgres may not. The job is scheduled only
-- where the extension is (or can be made), so `supabase db push`, `supabase db
-- reset` and `supabase test db` run everywhere; without it the function is still
-- there to call by hand or from another scheduler.

create function public.purge_synced_writes()
returns bigint
language sql
security invoker
set search_path = pg_catalog
as $$
  with gone as (
    delete from public.synced_writes
    where synced_at < now() - interval '30 days'
    returning 1
  )
  select count(*) from gone;
$$;

comment on function public.purge_synced_writes() is
  'Deletes the synced_writes rows older than 30 days (the idempotency record of writes that waited offline) and answers how many. Run daily by pg_cron; not callable by members.';

-- Run by the cron job (as the role that scheduled it) or by an operator, never by a member.
revoke all on function public.purge_synced_writes() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
      begin
        create extension pg_cron;
      exception when others then
        raise notice 'pg_cron could not be enabled (%): purge_synced_writes() is not scheduled', sqlerrm;
      end;
    else
      raise notice 'pg_cron is not available here: purge_synced_writes() is not scheduled';
    end if;
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      -- By name: scheduling again replaces the job instead of doubling it.
      perform cron.schedule('purge-synced-writes', '30 3 * * *', 'select public.purge_synced_writes()');
    exception when others then
      raise notice 'purge-synced-writes could not be scheduled (%)', sqlerrm;
    end;
  end if;
end;
$$;
