-- pg_cron's own log is never trimmed (perf assessment F6, docs/perf/backend.md).
--
-- cron.job_run_details gets a row per job run (~456 a day: shelf-publish every five
-- minutes, enrich-drain every ten, the hourly and daily jobs) and nothing deletes
-- them: ~170k rows a year, and every run writes its row twice. A week of history is
-- plenty to see why a job failed.
--
-- Written like the other purges (purge-client-errors, purge-synced-writes): a function,
-- scheduled by name (scheduling again replaces the job) and only where pg_cron is, so
-- the migration also runs on a Postgres without it. plpgsql, not sql: the body names
-- cron.job_run_details, which a Postgres without pg_cron does not have, and a sql
-- function would be checked at create time.
create function private.purge_cron_log()
returns bigint
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_gone bigint;
begin
  -- A run still going has no end_time and stays.
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  get diagnostics v_gone = row_count;
  return v_gone;
end;
$$;

comment on function private.purge_cron_log() is
  'Deletes the cron.job_run_details rows that ended more than 7 days ago and answers how many. Run daily by pg_cron; not callable by members.';

revoke all on function private.purge_cron_log() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
      begin
        create extension pg_cron;
      exception when others then
        raise notice 'pg_cron could not be enabled (%): private.purge_cron_log() is not scheduled', sqlerrm;
      end;
    else
      raise notice 'pg_cron is not available here: private.purge_cron_log() is not scheduled';
    end if;
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      -- By name: scheduling again replaces the job instead of doubling it.
      -- 03:15 UTC, ahead of the other purges (03:30 / 03:45) and the backup at 02:30.
      perform cron.schedule('purge-cron-log', '15 3 * * *', 'select private.purge_cron_log()');
    exception when others then
      raise notice 'pg_cron is there but the job could not be scheduled (%): private.purge_cron_log() is not scheduled', sqlerrm;
    end;
  end if;
end;
$$;
