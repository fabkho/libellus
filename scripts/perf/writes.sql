-- Single-write cost through sync_write (the outbox's one call), as seeded member :member, under RLS:
-- update_progress on an open read, start_reading + finish_reading on a want-to-read entry, add_to_library
-- of a Catalogue Book. Each loop is one transaction per call (the DO block commits nothing, so the
-- loop runs in one transaction; the numbers are per-call work, not commit latency).
--   docker exec -i <db> psql -U postgres -v member=2 -v n=200 -f - < scripts/perf/writes.sql
\set ON_ERROR_STOP on
\if :{?member}
\else
  \set member 2
\endif
\if :{?n}
\else
  \set n 200
\endif
select md5('member' || :member)::uuid as mid \gset
select set_config('perf.n', :'n', false), set_config('perf.mid', :'mid', false);
select e.id as reading_entry from public.library_entries e join public.reading_sessions s on s.entry_id = e.id and s.outcome is null
 where e.member_id = :'mid' limit 1 \gset
select set_config('request.jwt.claims', json_build_object('sub', :'mid', 'role', 'authenticated')::text, false);
select set_config('perf.entry', :'reading_entry', false);
set role authenticated;
begin;
do $$
declare
  v_n int := current_setting('perf.n')::int;
  v_entry uuid := current_setting('perf.entry')::uuid;
  v_t timestamptz; i int; v_c int := 0; v_e uuid;
begin
  v_t := clock_timestamp();
  for i in 1 .. v_n loop
    perform public.sync_write(gen_random_uuid(), 'update_progress',
      jsonb_build_object('p_entry_id', v_entry, 'p_percent', (i % 90) + 5, 'p_day', current_date));
  end loop;
  raise notice 'sync_write update_progress: % ms per call', round((extract(epoch from clock_timestamp() - v_t) * 1000 / v_n)::numeric, 2);

  v_t := clock_timestamp();
  for i in 1 .. v_n loop
    perform public.sync_write(gen_random_uuid(), 'add_to_library',
      jsonb_build_object('p_book', jsonb_build_object('title', 'Write bench ' || i, 'authors', jsonb_build_array('Bencher'),
         'isbn13', '978' || lpad((800000000 + i)::text, 10, '0'), 'source', 'apple', 'apple_id', (800000000 + i)::text),
         'p_status', 'want_to_read'));
  end loop;
  raise notice 'sync_write add_to_library (new Catalogue Book): % ms per call', round((extract(epoch from clock_timestamp() - v_t) * 1000 / v_n)::numeric, 2);

  v_t := clock_timestamp();
  for v_e in select id from public.library_entries where member_id = current_setting('perf.mid')::uuid and status = 'want_to_read' limit v_n loop
    v_c := v_c + 1;
    perform public.sync_write(gen_random_uuid(), 'start_reading', jsonb_build_object('p_entry_id', v_e, 'p_started_on', current_date - 3));
    perform public.sync_write(gen_random_uuid(), 'finish_reading', jsonb_build_object('p_entry_id', v_e, 'p_ended_on', current_date, 'p_rating', 16, 'p_review', 'Fine.'));
  end loop;
  raise notice 'sync_write start_reading + finish_reading (pair): % ms per pair', round((extract(epoch from clock_timestamp() - v_t) * 1000 / greatest(v_c, 1))::numeric, 2);
end $$;
rollback;
