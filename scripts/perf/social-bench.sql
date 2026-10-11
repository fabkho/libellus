-- p50 / p95 of the Social v1 readers, as 20 different seeded members (RLS on, role authenticated),
-- warm cache, on top of scripts/perf/seed-social.sql. Server time inside the database only.
--   docker exec -i <db> psql -U postgres -v runs=200 < scripts/perf/social-bench.sql
\set ON_ERROR_STOP on
\if :{?runs}
\else
  \set runs 200
\endif
select set_config('perf.runs', :'runs', false);
create temp table perf_lat (what text, ms numeric);
grant all on perf_lat to authenticated;
create temp table perf_m as select id, row_number() over (order by email) as n from auth.users where email like 'member%@perf.test';
grant select on perf_m to authenticated;
do $$
declare
  v_runs int := current_setting('perf.runs')::int;
  v_n int; v_me uuid; v_other uuid; v_t timestamptz; i int; v_before timestamptz; v_id uuid; v_page jsonb;
begin
  execute 'set local role authenticated';
  for i in 1 .. v_runs loop
    v_n := 2 + (i % 20);
    select id into v_me from perf_m where n = v_n;
    select id into v_other from perf_m where n = v_n + 1;
    perform set_config('request.jwt.claims', json_build_object('sub', v_me, 'role', 'authenticated')::text, true);

    v_t := clock_timestamp(); v_page := public.feed(null, null, 30);
    insert into perf_lat values ('feed page 1 (30)', extract(epoch from clock_timestamp() - v_t) * 1000);
    if jsonb_array_length(v_page) > 0 then
      v_before := (v_page -> (jsonb_array_length(v_page) - 1) ->> 'at')::timestamptz;
      v_id := (v_page -> (jsonb_array_length(v_page) - 1) ->> 'id')::uuid;
      v_t := clock_timestamp(); perform public.feed(v_before, v_id, 30);
      insert into perf_lat values ('feed page 2 (keyset)', extract(epoch from clock_timestamp() - v_t) * 1000);
    end if;
    v_t := clock_timestamp(); perform public.member_profile(v_other);
    insert into perf_lat values ('member_profile (followed)', extract(epoch from clock_timestamp() - v_t) * 1000);
    v_t := clock_timestamp(); perform public.member_profile((select id from perf_m where n = 250 + (i % 40)));
    insert into perf_lat values ('member_profile (stranger)', extract(epoch from clock_timestamp() - v_t) * 1000);
    v_t := clock_timestamp(); perform public.member_want(v_other);
    insert into perf_lat values ('member_want', extract(epoch from clock_timestamp() - v_t) * 1000);
    v_t := clock_timestamp(); perform public.member_reading_record(v_other);
    insert into perf_lat values ('member_reading_record', extract(epoch from clock_timestamp() - v_t) * 1000);
    v_t := clock_timestamp(); perform public.my_people();
    insert into perf_lat values ('my_people', extract(epoch from clock_timestamp() - v_t) * 1000);
  end loop;
end $$;
reset role;
select what, count(*) as n, round(percentile_cont(0.5) within group (order by ms)::numeric, 2) as p50_ms,
       round(percentile_cont(0.95) within group (order by ms)::numeric, 2) as p95_ms, round(max(ms)::numeric, 2) as max_ms
  from perf_lat group by what order by what;
