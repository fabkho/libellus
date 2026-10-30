-- Own covers, part 6 (20261110010000_cover_gc.sql; docs/plans/owned-covers.md §6): deleting what no Library holds.
--   supabase test db
--
--   * nothing acts while the feature is off: the mark, the claim, the weekly job, the kick (GC is irreversible)
--   * the mark: objects no Book in a Library uses get orphaned_at once; an object used again loses it
--   * the grace: nothing is claimed before 30 days, and an object used again in the meantime is never claimed
--   * the claim: one statement, a lease, clears the key of Books still pointing at the object, a small batch
--   * the race with a store: a reservation first keeps the object, a reservation after the claim is refused
--   * done removes the rows, failed keeps them (released, and not tried again within the week)
--   * the entry-against-claim case: the Book lost its key, the reconcile queues it again
--   * the weekly job, the schedule and who may call what

begin;
select plan(76);
set local client_min_messages = warning;

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-COVER-GC', 'cover gc test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-COVER-GC"}'::jsonb, now(), now(), now());
  return v_id;
end;
$$;
create or replace function tests.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
create or replace function tests.act_as_service()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end;
$$;
create or replace function tests.hex(p_n integer)
returns text language sql immutable as $$ select lpad(to_hex(p_n), 32, '0') $$;
-- A Book carrying a stored copy under key n (null: none), in a Library or not.
create or replace function tests.book(p_n integer, p_key integer, p_member uuid default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.books (title, authors, source, isbn13, cover_url, cover_key, cover_widths)
  values ('Gc Book ' || p_n, '{A}', 'import', '979000009' || lpad(p_n::text, 4, '0'), 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/aa/bb/cc/gc' || p_n || '.jpg/600x900bb.jpg',
          case when p_key is null then null else tests.hex(p_key) end, case when p_key is null then null else '{120,600}'::smallint[] end)
  returning id into v_id;
  if p_member is not null then insert into public.library_entries (member_id, book_id) values (p_member, v_id); end if;
  return v_id;
end;
$$;
-- An object row, orphaned `p_days` ago (null: not orphaned).
create or replace function tests.obj(p_n integer, p_widths smallint[], p_days integer default null)
returns void language sql as $$
  insert into private.cover_objects (key, widths, content_type, bytes, stored_at, orphaned_at)
  values (tests.hex(p_n), p_widths, case when p_widths is null then null else 'image/webp' end, case when p_widths is null then null else 1000 end,
          case when p_widths is null then null else now() end, case when p_days is null then null else now() - make_interval(days => p_days) end)
$$;
create or replace function tests.orphaned(p_n integer)
returns boolean language sql as $$ select orphaned_at is not null from private.cover_objects where key = tests.hex(p_n) $$;
create or replace function tests.held(p_n integer)
returns boolean language sql as $$ select deleting_at is not null from private.cover_objects where key = tests.hex(p_n) $$;
create or replace function tests.claimed_keys(p_limit integer default 100)
returns text language sql as $$
  select coalesce(string_agg(key, ',' order by key), '-') from public.cover_gc_claim(p_limit)
$$;
create or replace function tests.q(p_book uuid)
returns text language sql as $$
  select coalesce((select concat_ws(',', state, attempts, coalesce(last_error, '-')) from private.cover_store_queue where book_id = p_book), 'none')
$$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

select tests.member('ida@cover-gc.test') as ida_id \gset
select tests.member('max@cover-gc.test') as max_id \gset

-- The world:
--   1  used by a Book in Ida's Library                       never orphaned
--   2  used by a Book in nobody's Library (key kept)         orphaned by the mark
--   3  used by no Book at all                                orphaned by the mark; widths null (a reservation whose upload failed)
--   4  used by two Books, one in Max's Library              never orphaned (a lent cover)
--   5  used by a Book in nobody's Library, orphaned 40 days ago, mark has not run: stays until the claim re-checks
select tests.book(1, 1, :'ida_id') as book1 \gset
select tests.book(2, 2) as book2 \gset
select tests.book(3, 4) as book4a \gset
select tests.book(4, 4, :'max_id') as book4b \gset
select tests.obj(1, '{120,600}');
select tests.obj(2, '{120,600}');
select tests.obj(3, null);
select tests.obj(4, '{120,600}');

-- ------------------------------------------------------- off: nothing acts

select is((select enabled from private.cover_store_settings), false, 'the feature is off');
select is(public.cover_gc_mark() ->> 'state', 'off', 'the mark does nothing while it is off');
select is((select count(*)::int from private.cover_objects where orphaned_at is not null), 0, 'and marks nothing');
select is(private.cover_gc_weekly(), 'off', 'the weekly job does nothing while it is off');
select is(private.cover_gc_kick(), 'off', 'and the kick');
-- an object that would be claimed if it were on
update private.cover_objects set orphaned_at = now() - interval '40 days' where key = tests.hex(3);
select is(tests.claimed_keys(), '-', 'the claim takes nothing while it is off, however old the object');
select is(tests.held(3), false, 'and holds nothing');
select is((select count(*)::int from private.cover_objects), 4, 'every object is still there');
update private.cover_objects set orphaned_at = null where key = tests.hex(3);

update private.cover_store_settings set enabled = true;

-- ------------------------------------------------------------------- mark

select is(public.cover_gc_mark() ->> 'marked', '2', 'the mark orphans the two objects no Book in a Library uses');
select is((select array_agg(tests.orphaned(n) order by n) from generate_series(1, 4) n), array[false, true, true, false], 'objects 2 and 3, not the used ones (a lent cover is used while one holder has it)');
update private.cover_objects set orphaned_at = now() - interval '5 days' where key = tests.hex(2);
select is(public.cover_gc_mark() ->> 'marked', '0', 'a second mark marks nothing new');
select is((select orphaned_at < now() - interval '4 days' from private.cover_objects where key = tests.hex(2)), true, 'and does not restart the 30 days');

-- referenced again: the mark is cleared
insert into public.library_entries (member_id, book_id) values (:'max_id', :'book2');
select is(public.cover_gc_mark() ->> 'cleared', '1', 'an object used again loses its mark');
select is(tests.orphaned(2), false, 'object 2 is kept');
delete from public.library_entries where book_id = :'book2';
select is(public.cover_gc_mark() ->> 'marked', '1', 'removed again, it is marked again');
select is((select orphaned_at > now() - interval '1 minute' from private.cover_objects where key = tests.hex(2)), true, 'with the 30 days restarted');

-- an object GC holds is left alone by the mark
update private.cover_objects set deleting_at = now() where key = tests.hex(3);
update private.cover_objects set orphaned_at = null where key = tests.hex(3);
select is(public.cover_gc_mark() ->> 'marked', '0', 'an object GC holds is not marked');
update private.cover_objects set deleting_at = null where key = tests.hex(3);
select is(public.cover_gc_mark() ->> 'marked', '1', 'released, it is');

-- ------------------------------------------------------------------ grace

select is(tests.claimed_keys(), '-', 'nothing is claimed in the first days');
update private.cover_objects set orphaned_at = now() - interval '29 days 23 hours' where key in (tests.hex(2), tests.hex(3));
select is(tests.claimed_keys(), '-', 'nor on the 30th day');
select is((select count(*)::int from private.cover_objects where deleting_at is not null), 0, 'nothing is held');
select is((select cover_key from public.books where id = :'book2'), tests.hex(2), 'and the Book keeps its key meanwhile');

-- an object used again after the mark, before the claim: the claim re-checks and never takes it
insert into private.cover_objects (key, widths, orphaned_at) values (tests.hex(5), '{120,600}', now() - interval '40 days');
select tests.book(5, 5, :'max_id') as book5 \gset
select is(tests.claimed_keys(), '-', 'an old mark on an object a Library uses again is not claimed (the mark ran last week)');
select is(tests.held(5), false, 'and holds nothing');
select is((select cover_key from public.books where id = :'book5'), tests.hex(5), 'the Book keeps its key');
delete from public.library_entries where book_id = :'book5';

-- ------------------------------------------------------------------ claim

update private.cover_objects set orphaned_at = now() - interval '31 days' where key in (tests.hex(2), tests.hex(3));
select tests.act_as_service();
select is(
  (select jsonb_agg(jsonb_build_object('key', key, 'widths', widths) order by key) from public.cover_gc_claim(100)),
  jsonb_build_array(
    jsonb_build_object('key', tests.hex(2), 'widths', '[120,600]'::jsonb),
    jsonb_build_object('key', tests.hex(3), 'widths', null),
    jsonb_build_object('key', tests.hex(5), 'widths', '[120,600]'::jsonb)),
  'the claim answers each object past its 30 days and unused, with its widths (null for a reservation that never finished)');
reset role;
select is((select array_agg(tests.held(n) order by n) from generate_series(1, 5) n), array[false, true, true, false, true], 'and holds them (deleting_at is the lease)');
select is((select cover_key from public.books where id = :'book2'), null, 'it cleared the key of the Book still pointing at object 2');
select is((select cover_widths from public.books where id = :'book2'), null, 'and its widths');
select is((select cover_key from public.books where id = :'book5'), null, 'and of the Book (outside every Library) of object 5');
select is((select cover_key from public.books where id = :'book1'), tests.hex(1), 'a Book of an object that was not claimed keeps its key');
select is((select cover_key from public.books where id = :'book4b'), tests.hex(4), 'the lent cover keeps its key');
select tests.act_as_service();
select is(tests.claimed_keys(), '-', 'a second claim finds them held (the lease)');
reset role;

-- the lease runs out: a run that died
update private.cover_objects set deleting_at = now() - interval '20 minutes' where key = tests.hex(3);
select tests.act_as_service();
select is(tests.claimed_keys(), tests.hex(3), 'a row held for more than 15 minutes is claimed again');
select is(tests.claimed_keys(), '-', 'and then held again');
reset role;

-- the batch is small
select tests.obj(10 + n, '{100}', 40) from generate_series(1, 5) n;
select tests.act_as_service();
select is((select count(*)::int from public.cover_gc_claim(3)), 3, 'the claim takes at most the limit');
select is((select count(*)::int from public.cover_gc_claim(3)), 2, 'and the rest next');
select is((select count(*)::int from public.cover_gc_claim(null)), 0, 'then nothing');
reset role;
delete from private.cover_objects where key in (select tests.hex(10 + n) from generate_series(1, 5) n);

-- ---------------------------------------------------- the race with a store

-- reserve after the claim: refused, the row is GC's until done
select is(public.cover_store_reserve(tests.hex(2)), false, 'a store of an object being deleted is refused');
select is(tests.held(2), true, 'and the object stays GC''s');
-- reserve before the claim: the object is kept
select tests.obj(20, '{120}', 40);
select is(public.cover_store_reserve(tests.hex(20)), true, 'a store that reserves first is accepted');
select is(tests.orphaned(20), false, 'and clears the mark');
select tests.act_as_service();
select is(tests.claimed_keys(), '-', 'so the claim no longer takes the object');
reset role;
select is(tests.held(20), false, 'and holds nothing');
-- the done of a store keeps the object too, and a done after the claim writes nothing
select tests.obj(21, '{120}', 40);
select is(public.cover_store_done((select tests.book(21, null)), 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/aa/bb/cc/gc21.jpg/600x900bb.jpg', tests.hex(21), '{120}', 100), true, 'a store''s done on an old mark is accepted');
select is(tests.orphaned(21), false, 'and clears the mark');
select is(public.cover_store_done(:'book2', 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/aa/bb/cc/gc2.jpg/600x900bb.jpg', tests.hex(2), '{120}', 100), false, 'a done for an object GC holds writes nothing');
select is((select cover_key from public.books where id = :'book2'), null, 'the Book stays without a key');

-- ------------------------------------------------ the entry against the claim

-- A Library entry appears for the Book whose key the claim cleared: nothing is lost, the reconcile queues it again.
insert into public.library_entries (member_id, book_id) values (:'ida_id', :'book2');
select is(tests.q(:'book2'), 'none', 'a Book whose key the claim cleared has no queue row yet');
select is(private.cover_store_reconcile() >= 1, true, 'the reconcile finds it');
select is(tests.q(:'book2'), 'queued,0,-', 'and queues it');
delete from private.cover_store_queue where book_id = :'book2';
delete from public.library_entries where book_id = :'book2';

-- ------------------------------------------------------------ done, failed

select tests.act_as_service();
select is(public.cover_gc_done(array[tests.hex(2), tests.hex(1), 'not-a-key']), 1, 'done removes the rows of objects GC holds, and only those');
reset role;
select is((select count(*)::int from private.cover_objects where key in (tests.hex(1), tests.hex(2))), 1, 'object 1 (not held) stays, object 2 is gone');
select is(public.cover_store_reserve(tests.hex(2)), true, 'the key can be stored again afresh once its row is gone');
select tests.act_as_service();
select is(public.cover_gc_done(array[]::text[]), 0, 'done of no keys does nothing');
select is(public.cover_gc_done(null), 0, 'nor of null');

-- failed: the row stays, released
select is(public.cover_gc_failed(array[tests.hex(3), tests.hex(1)]), 1, 'a failed delete releases the held row (not the others)');
reset role;
select is((select array_agg(tests.held(n) order by n) from generate_series(1, 3) n), array[false, false, false], 'nothing is held');
select is((select count(*)::int from private.cover_objects where key = tests.hex(3)), 1, 'object 3 is still there, to be tried next week');
select tests.act_as_service();
select is(tests.claimed_keys(), '-', 'a failed one is not claimed again in the same run');
reset role;
select is(public.cover_store_reserve(tests.hex(3)), true, 'and a store of it is accepted meanwhile (uploads are idempotent)');
select is(tests.orphaned(3), false, 'which keeps it');
update private.cover_objects set orphaned_at = now() - interval '40 days' where key = tests.hex(3);
update private.cover_objects set gc_retry_at = now() - interval '1 minute' where key = tests.hex(3);
select tests.act_as_service();
select is(tests.claimed_keys(), tests.hex(3), 'next week it is claimed again');
reset role;

-- ------------------------------------------------------------ the weekly job

update private.cover_store_settings set function_url = null;
select is(private.cover_gc_weekly(), 'off', 'with no address nothing is sent');
update private.cover_store_settings set function_url = 'https://example.invalid/functions/v1/cover-store';
delete from private.cover_objects where deleting_at is not null;
update private.cover_objects set orphaned_at = null;
select count(*)::int as net_before from net.http_request_queue \gset
select is(private.cover_gc_weekly(), 'idle', 'with nothing orphaned past 30 days it sends nothing');
select is((select array_agg(tests.orphaned(n) order by n) from unnest(array[1, 2, 4]) n), array[false, true, false], 'the weekly job ran the mark first (1 and 4 are used)');
select tests.obj(30, '{120}', 40);
select is(private.cover_gc_weekly(), 'unavailable', 'with an object due and no token in the Vault it is not sent');
select vault.create_secret('test-token', 'cover_store_token');
select is(private.cover_gc_weekly(), 'sent', 'with one it is sent');
select is((select count(*)::int from net.http_request_queue), :net_before + 1, 'as one request');
select is((select convert_from(body, 'utf8')::jsonb from net.http_request_queue order by id desc limit 1), '{"action": "gc"}'::jsonb, 'asking for `gc`');
update private.cover_store_settings set enabled = false;
select is(private.cover_gc_weekly(), 'off', 'and nothing again once the feature is off');
select is((select count(*)::int from net.http_request_queue), :net_before + 1, 'not even a queued request');

-- ------------------------------------------------------------------- grants

select is(
  (select count(*)::int from (values
    ('private.cover_gc_enabled()'), ('private.cover_gc_due()'), ('private.cover_gc_kick()'), ('private.cover_gc_weekly()'),
    ('public.cover_gc_mark()'), ('public.cover_gc_claim(integer)'), ('public.cover_gc_done(text[])'), ('public.cover_gc_failed(text[])')) f (fn)
    where has_function_privilege('authenticated', f.fn, 'execute') or has_function_privilege('anon', f.fn, 'execute')),
  0, 'members and anon can call none of them');
select is(
  (select count(*)::int from (values
    ('public.cover_gc_mark()'), ('public.cover_gc_claim(integer)'), ('public.cover_gc_done(text[])'), ('public.cover_gc_failed(text[])')) f (fn)
    where has_function_privilege('service_role', f.fn, 'execute')),
  4, 'the function''s four are the service role''s');
select ok(not has_function_privilege('service_role', 'private.cover_gc_weekly()', 'execute'), 'the weekly job is pg_cron''s alone');
select is(
  (select count(*)::int from cron.job where jobname = 'cover-store-gc' and schedule = '30 2 * * 0') in (0, 1), true, 'the weekly job is scheduled (Sunday night) where pg_cron is');

select * from finish();
rollback;
