-- The idempotency record does not grow forever:
--   supabase test db
--
-- `purge_synced_writes()` deletes the synced_writes rows older than 30 days and
-- says how many; a daily pg_cron job calls it where pg_cron exists. Assertions ask
-- about the rows this test made, never about how many rows the table holds.

begin;
select plan(9);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-PURGE', 'purge test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-PURGE"}'::jsonb, now(), now(), now());
  return v_id;
end;
$$;

create temp table ids on commit drop as
  select tests.member('purge-a@libellus.test') as ada, tests.member('purge-b@libellus.test') as bo;
grant select on ids to public;

-- Two members; one row of each at every age that matters.
insert into public.synced_writes (request_id, member_id, action, synced_at)
select r.id, case r.who when 'ada' then ids.ada else ids.bo end, 'update_progress', now() - r.age
from ids,
  (values ('00000000-0000-4000-8000-0000000000a1'::uuid, 'ada', interval '31 days'),
          ('00000000-0000-4000-8000-0000000000a2'::uuid, 'ada', interval '29 days'),
          ('00000000-0000-4000-8000-0000000000a3'::uuid, 'ada', interval '1 hour'),
          ('00000000-0000-4000-8000-0000000000b1'::uuid, 'bo',  interval '400 days'),
          ('00000000-0000-4000-8000-0000000000b2'::uuid, 'bo',  interval '2 days')) as r (id, who, age);

-- ------------------------------------------------------------------ the sweep

select cmp_ok(public.purge_synced_writes(), '>='::text, 2::bigint, 'the sweep reports at least the two old rows it deleted');

select is((select count(*)::int from public.synced_writes
           where request_id in ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1')),
          0, 'rows older than 30 days are gone, whoever they belong to');
select is((select count(*)::int from public.synced_writes
           where request_id in ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3',
                                '00000000-0000-4000-8000-0000000000b2')),
          3, 'rows younger than 30 days stay');
select is(public.purge_synced_writes() >= 0, true, 'a second sweep finds nothing of ours and does not fail');
select is((select count(*)::int from public.synced_writes
           where request_id in ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3',
                                '00000000-0000-4000-8000-0000000000b2')),
          3, 'and still leaves the young ones');

-- --------------------------------------------------------- who may run it

select is(has_function_privilege('anon', 'public.purge_synced_writes()', 'execute'), false, 'anon cannot run the sweep');
select is(has_function_privilege('authenticated', 'public.purge_synced_writes()', 'execute'), false, 'a member cannot run the sweep');

-- ---------------------------------------------------------------- the schedule

-- Only where pg_cron is: the migration skips the job on a Postgres without it.
select case
  when exists (select 1 from pg_extension where extname = 'pg_cron')
  then is((select schedule from cron.job where jobname = 'purge-synced-writes'),
          '30 3 * * *', 'pg_cron runs the sweep daily')
  else skip('pg_cron is not installed here', 1)
end;
select case
  when exists (select 1 from pg_extension where extname = 'pg_cron')
  then is((select command from cron.job where jobname = 'purge-synced-writes'),
          'select public.purge_synced_writes()', 'and the job calls the sweep')
  else skip('pg_cron is not installed here', 1)
end;

select * from finish();
rollback;
