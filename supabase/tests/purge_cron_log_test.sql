-- pg_cron's run log is trimmed (perf assessment F6):
--   supabase test db
--
-- `private.purge_cron_log()` deletes the cron.job_run_details rows that ended more than
-- 7 days ago and says how many; a daily pg_cron job calls it where pg_cron exists.
-- Assertions ask about the rows this test made, never about how many rows the table holds.

begin;
select plan(7);

select has_function('private', 'purge_cron_log', array[]::text[], 'the sweep exists');
select ok(not has_function_privilege('authenticated', 'private.purge_cron_log()', 'execute')
          and not has_function_privilege('anon', 'private.purge_cron_log()', 'execute'),
          'members cannot call it');

-- The sweep and the schedule only where pg_cron is: the migration skips both on a Postgres without it.
select case
  when exists (select 1 from pg_extension where extname = 'pg_cron')
  then is((select schedule || ' ' || command from cron.job where jobname = 'purge-cron-log'),
          '15 3 * * * select private.purge_cron_log()', 'pg_cron runs the sweep daily, ahead of the other purges')
  else skip('pg_cron is not installed here', 1)
end;
select case
  when exists (select 1 from pg_extension where extname = 'pg_cron')
  then is((select count(*) from cron.job where jobname = 'purge-cron-log'), 1::bigint, 'and the job is there once')
  else skip('pg_cron is not installed here', 1)
end;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    insert into cron.job_run_details (jobid, runid, command, status, start_time, end_time) values
      (-1, -901, 'purge-cron-log test: old',        'succeeded', now() - interval '8 days',  now() - interval '8 days'),
      (-1, -902, 'purge-cron-log test: just over',  'succeeded', now() - interval '7 days' - interval '1 minute', now() - interval '7 days' - interval '1 minute'),
      (-1, -903, 'purge-cron-log test: young',      'succeeded', now() - interval '6 days',  now() - interval '6 days'),
      (-1, -904, 'purge-cron-log test: today',      'succeeded', now() - interval '1 hour',  now() - interval '1 hour'),
      (-1, -905, 'purge-cron-log test: running',    'running',   now() - interval '9 days',  null);
  end if;
end;
$$;

select case
  when exists (select 1 from pg_extension where extname = 'pg_cron')
  then ok(private.purge_cron_log() >= 2, 'the sweep answers how many it deleted')
  else skip('pg_cron is not installed here', 1)
end;
select case
  when exists (select 1 from pg_extension where extname = 'pg_cron')
  then is((select array_agg(runid order by runid) from cron.job_run_details where runid between -905 and -901),
          array[-905, -904, -903]::bigint[], 'rows that ended over 7 days ago go; younger ones and a run still going stay')
  else skip('pg_cron is not installed here', 1)
end;
select case
  when exists (select 1 from pg_extension where extname = 'pg_cron')
  then is(private.purge_cron_log() >= 0, true, 'a second sweep is harmless')
  else skip('pg_cron is not installed here', 1)
end;

select * from finish();
rollback;
