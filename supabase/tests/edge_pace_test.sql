-- One pace for an upstream that counts requests per address (supabase test db):
--   public.edge_pace, edge_pace_take(bucket, gap_ms, max_wait_ms), edge_pace_hold(bucket, ms).
--
-- Every edge instance books its turn here before it asks Open Library (3 a second) or the National
-- Library (5 a second): the turns are `gap_ms` apart however many instances ask, a turn that would be
-- further away than the caller will wait is refused (and nothing is booked), and an upstream's
-- `Retry-After` holds every instance. Service role only. Waits are real time: the assertions are
-- ranges, a few milliseconds wide at the edges.

begin;
select plan(22);

-- ------------------------------------------------------------------ the shape

select has_table('public', 'edge_pace', 'the table is there');
select ok(not has_table_privilege('authenticated', 'public.edge_pace', 'select, insert, update, delete')
          and not has_table_privilege('anon', 'public.edge_pace', 'select, insert, update, delete'),
          'members and visitors have no grant on it');
select ok(not has_function_privilege('authenticated', 'public.edge_pace_take(text, integer, integer)', 'execute')
          and not has_function_privilege('anon', 'public.edge_pace_take(text, integer, integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.edge_pace_hold(text, integer)', 'execute')
          and not has_function_privilege('anon', 'public.edge_pace_hold(text, integer)', 'execute')
          and has_function_privilege('service_role', 'public.edge_pace_take(text, integer, integer)', 'execute')
          and has_function_privilege('service_role', 'public.edge_pace_hold(text, integer)', 'execute'),
          'only the service role takes a turn or holds the pace');

set local role service_role;

-- ---------------------------------------------------------------- the turns

select ok((select granted and wait_ms = 0 from public.edge_pace_take('openlibrary', 1000, 5000)), 'the first turn is now');
select ok((select granted and wait_ms between 900 and 1000 from public.edge_pace_take('openlibrary', 1000, 5000)), 'the next is one gap later');
select ok((select granted and wait_ms between 1900 and 2000 from public.edge_pace_take('openlibrary', 1000, 5000)), 'and the next two gaps later, however fast they asked');

select is((select granted from public.edge_pace_take('dnb', 200, 5000)), true, 'another upstream has its own pace');
select ok((select wait_ms = 0 from public.edge_pace_take('goodreads-cover', 200, 5000)), 'and the next one too');

-- Too far away for the caller: refused, with how long until it would fit, and nothing booked.
select is((select granted from public.edge_pace_take('openlibrary', 1000, 1500)), false,
          'a turn three gaps away is more than 1.5 s: refused');
select ok((select wait_ms between 1300 and 1500 from public.edge_pace_take('openlibrary', 1000, 1500)),
          'it says to come back when a turn is within 1.5 s (about 1.5 s: 3 s away, minus 1.5 s)');
select ok((select granted and wait_ms between 2900 and 3000 from public.edge_pace_take('openlibrary', 1000, 5000)),
          'the refusals booked nothing: the next turn is still the fourth');

-- A wait of zero means: a turn now, or no.
select is((select granted from public.edge_pace_take('openlibrary', 1000, 0)), false, 'a caller who will not wait gets no turn behind a queue');

-- --------------------------------------------------------------- Retry-After

select public.edge_pace_hold('goodreads-cover', 8000);
select ok((select granted and wait_ms between 7800 and 8000 from public.edge_pace_take('goodreads-cover', 200, 30000)),
          'an upstream''s Retry-After holds the pace: the next turn is after it');
select public.edge_pace_hold('goodreads-cover', 1000);
select ok((select granted and wait_ms > 7000 from public.edge_pace_take('goodreads-cover', 200, 30000)),
          'a shorter hold never shortens the one that is on');
select public.edge_pace_hold('fresh-upstream', 4000);
select ok((select granted and wait_ms between 3800 and 4000 from public.edge_pace_take('fresh-upstream', 200, 30000)), 'a hold on an upstream nobody asked yet makes its row');
select lives_ok($$select public.edge_pace_hold('fresh-upstream', 3600000)$$, 'an hour is cut to a minute, not refused');
select ok((select wait_ms <= 60000 from public.edge_pace_take('fresh-upstream', 200, 60000)), 'at most');

-- ---------------------------------------------------------------- the checks

select throws_ok($$select * from public.edge_pace_take('openlibrary', 0, 1000)$$, '22023', 'pace_invalid', 'a gap of nothing is refused');
select throws_ok($$select * from public.edge_pace_take('openlibrary', 1000, -1)$$, '22023', 'pace_invalid', 'a negative patience too');
select throws_ok($$select * from public.edge_pace_take('openlibrary', 1000, 60001)$$, '22023', 'pace_invalid', 'and one over a minute');
select throws_ok($$select * from public.edge_pace_take('Not A Bucket', 1000, 1000)$$, '23514', null, 'a bucket must be a lower-case name');

reset role;
select is((select count(*)::int from public.edge_pace where bucket in ('openlibrary', 'dnb', 'goodreads-cover', 'fresh-upstream')), 4, 'one row per upstream');

select * from finish();
rollback;
