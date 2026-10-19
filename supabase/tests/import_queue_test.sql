-- The import queue: one member's import does its lookups at a time (supabase test db):
--   import_slot_take / import_slot_beat / import_slot_leave, public.import_queue.
--
-- The first to take the slot has it, the others wait in the order they came, and see how many imports
-- are ahead of them and how many books those still have to look up. The running import's beat keeps
-- the slot; a place whose beat is older than 75 seconds is swept by the next call and the slot goes to
-- the oldest waiting. One place per member: her second device sees her own row (mine = false) and
-- neither starts a second import, nor keeps hers alive, nor ends it. Leaving gives the slot on at once.
-- Members read and write nothing but through these functions; the account going takes the place along.

begin;
select plan(61);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-QUEUE', 'import queue test', 10);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_build_object('invite_code', 'T-QUEUE'), now(), now(), now());
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

create or replace function tests.act_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end;
$$;

-- Past the API's walls: what the table holds, and a place that stopped beating.
create or replace function tests.places()
returns bigint language sql security definer as $$ select count(*) from public.import_queue $$;
create or replace function tests.runners()
returns bigint language sql security definer as $$ select count(*) from public.import_queue where started_at is not null $$;
create or replace function tests.beat_at(p_member uuid)
returns timestamptz language sql security definer as $$ select beat_at from public.import_queue where member_id = p_member $$;
create or replace function tests.joined_at(p_member uuid)
returns timestamptz language sql security definer as $$ select joined_at from public.import_queue where member_id = p_member $$;
create or replace function tests.stop_beating(p_member uuid)
returns void language sql security definer as $$
  update public.import_queue set beat_at = clock_timestamp() - interval '76 seconds' where member_id = p_member
$$;
create or replace function tests.beat_a_while_ago(p_member uuid, p_seconds integer)
returns void language sql security definer as $$
  update public.import_queue set beat_at = clock_timestamp() - make_interval(secs => p_seconds) where member_id = p_member
$$;
create or replace function tests.second_runner(p_member uuid)
returns void language sql security definer as $$
  insert into public.import_queue (member_id, holder, started_at) values (p_member, 'device:x', clock_timestamp())
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

select tests.member('ada@queue.pgtap.test') as ada \gset
select tests.member('bo@queue.pgtap.test') as bo \gset
select tests.member('cy@queue.pgtap.test') as cy \gset
select tests.member('di@queue.pgtap.test') as di \gset

-- ------------------------------------------------------------------ the shape

select has_table('public', 'import_queue', 'the table is there');
select is((select relrowsecurity from pg_class where oid = 'public.import_queue'::regclass), true, 'with row level security on');
select ok(not has_table_privilege('anon', 'public.import_queue', 'select, insert, update, delete')
          and not has_table_privilege('authenticated', 'public.import_queue', 'select, insert, update, delete'),
          'neither a visitor nor a member is granted anything on it');
select ok(not has_function_privilege('anon', 'public.import_slot_take(text, integer)', 'execute')
          and not has_function_privilege('anon', 'public.import_slot_beat(text, integer)', 'execute')
          and not has_function_privilege('anon', 'public.import_slot_leave(text)', 'execute'),
          'a visitor calls none of the three');
select ok(has_function_privilege('authenticated', 'public.import_slot_take(text, integer)', 'execute')
          and has_function_privilege('authenticated', 'public.import_slot_beat(text, integer)', 'execute')
          and has_function_privilege('authenticated', 'public.import_slot_leave(text)', 'execute'),
          'a member calls them');
select ok(not has_function_privilege('authenticated', 'private.import_slot_sweep()', 'execute'), 'the sweep is closed to the API');
select tests.act_as(:'ada');
select throws_ok($$select 1 from public.import_queue$$, '42501', null, 'a member cannot read the table');
select throws_ok($$delete from public.import_queue$$, '42501', null, 'nor change it');
reset role;

-- ----------------------------------------------------------------- refusals

select tests.act_anon();
select throws_ok($$select * from public.import_slot_take('device:a', 10)$$, '42501', null, 'a visitor cannot take a place');
reset role;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.import_slot_take('device:a', 10)$$, '42501', 'not_signed_in', 'a token without a member cannot');
select throws_ok($$select * from public.import_slot_beat('device:a')$$, '42501', 'not_signed_in', 'nor beat');
select throws_ok($$select * from public.import_slot_leave('device:a')$$, '42501', 'not_signed_in', 'nor leave');
reset role;

select tests.act_as(:'ada');
select throws_ok($$select * from public.import_slot_take('', 10)$$, '22023', 'holder_invalid', 'an empty holder is refused');
select throws_ok($$select * from public.import_slot_take(repeat('x', 65), 10)$$, '22023', 'holder_invalid', 'a holder over 64 characters too');
select throws_ok($$select * from public.import_slot_take('device:a', -1)$$, '22023', 'rows_invalid', 'a negative count of books is refused');
select throws_ok($$select * from public.import_slot_take('device:a', 100001)$$, '22023', 'rows_invalid', 'and an absurd one');
reset role;
select is(tests.places(), 0::bigint, 'none of it took a place');

-- ---------------------------------------------------- the first has the slot

select tests.act_as(:'ada');
select is((select row(state, mine, ahead, rows_ahead)::text from public.import_slot_take('device:ada', 100)),
          '(running,t,0,0)', 'the first to ask has the slot, with nobody ahead');
select is((select row(state, mine, ahead, rows_ahead)::text from public.import_slot_take('device:ada', 100)),
          '(running,t,0,0)', 'asking again from the same device changes nothing');
reset role;
select is(tests.places(), 1::bigint, 'one place');

-- ---------------------------------------------------------- the others wait

select tests.act_as(:'bo');
select is((select row(state, mine, ahead, rows_ahead)::text from public.import_slot_take('device:bo', 50)),
          '(waiting,t,1,100)', 'the second waits, one import ahead with 100 books to look up');
reset role;
select tests.act_as(:'cy');
select is((select row(state, mine, ahead, rows_ahead)::text from public.import_slot_take('device:cy', 30)),
          '(waiting,t,2,150)', 'the third has two ahead and their 150 books');
reset role;
select is(tests.runners(), 1::bigint, 'one running, whoever asks');

-- Ada's progress counts: what she has still to do is what Bo and Cy wait for.
select tests.act_as(:'ada');
select is((select row(state, mine, ahead, rows_ahead)::text from public.import_slot_beat('device:ada', 40)),
          '(running,t,0,0)', 'her beat says she is running');
select is((select row(state, mine, ahead, rows_ahead)::text from public.import_slot_beat('device:ada', 10)),
          '(running,t,0,0)', 'a smaller count after it does not take progress back');
reset role;
select tests.act_as(:'cy');
select is((select row(state, mine, ahead, rows_ahead)::text from public.import_slot_beat('device:cy')),
          '(waiting,t,2,110)', 'Cy''s poll sees 60 left of Ada''s and Bo''s 50');
reset role;

-- A place that is the same device's keeps its turn when asked for again.
select is(tests.joined_at(:'bo') < tests.joined_at(:'cy'), true, 'Bo came before Cy');
select tests.act_as(:'bo');
select is((select row(state, mine, ahead)::text from public.import_slot_take('device:bo', 55)), '(waiting,t,1)', 'asking again keeps Bo''s turn');
reset role;
select is(tests.joined_at(:'bo') < tests.joined_at(:'cy'), true, 'still before Cy');

-- ---------------------------------------------------- her second device

select tests.act_as(:'ada');
select is((select row(state, mine, ahead)::text from public.import_slot_take('device:ada-2', 100)),
          '(running,f,0)', 'her second device is told her import is running (not hers to start)');
select is((select row(state, mine)::text from public.import_slot_beat('device:ada-2', 100)), '(running,f)', 'its beat sees the same');
reset role;
select is(tests.places(), 3::bigint, 'it took no place of its own');
select tests.beat_a_while_ago(:'ada', 50);
select tests.act_as(:'ada');
select is((select count(*)::int from public.import_slot_beat('device:ada-2', 100)), 1, 'the second device beats');
reset role;
select ok(tests.beat_at(:'ada') < clock_timestamp() - interval '45 seconds', 'but that does not keep her first device''s place alive');
select tests.act_as(:'ada');
select is((select row(state, mine)::text from public.import_slot_leave('device:ada-2')), '(running,f)', 'nor can it end it');
reset role;
select is(tests.places(), 3::bigint, 'her place is still there');
select tests.beat_a_while_ago(:'ada', 0);

-- ----------------------------------------------------------- cancel in line

select tests.act_as(:'di');
select is((select row(state, ahead)::text from public.import_slot_take('device:di', 20)), '(waiting,3)', 'Di is fourth');
select is((select row(state, mine, ahead, rows_ahead)::text from public.import_slot_leave('device:di')), '(none,f,0,0)', 'she leaves the line');
reset role;
select tests.act_as(:'cy');
select is((select ahead from public.import_slot_beat('device:cy')), 2, 'the others'' places do not move');
reset role;
select is(tests.places(), 3::bigint, 'and her place is gone');
select tests.act_as(:'bo');
select is((select row(state, mine, ahead)::text from public.import_slot_leave('device:bo')), '(none,f,0)', 'a waiting one leaves the line');
reset role;
select tests.act_as(:'cy');
select is((select row(state, ahead, rows_ahead)::text from public.import_slot_beat('device:cy')), '(waiting,1,60)', 'Cy is next after Ada''s remaining 60');
reset role;

-- ------------------------------------------------- the running one finishes

select tests.act_as(:'ada');
select is((select state from public.import_slot_leave('device:ada')), 'none', 'Ada is done');
reset role;
select is(tests.runners(), 1::bigint, 'the slot went on at once');
select tests.act_as(:'cy');
select is((select row(state, mine, ahead)::text from public.import_slot_beat('device:cy')), '(running,t,0)', 'to Cy');
reset role;

-- ------------------------------------------------------- the beat stops

select tests.act_as(:'ada');
select is((select state from public.import_slot_take('device:ada', 80)), 'waiting', 'Ada asks again and waits behind Cy');
reset role;
select tests.stop_beating(:'cy');
select tests.act_as(:'ada');
select is((select row(state, mine, ahead)::text from public.import_slot_beat('device:ada')), '(running,t,0)',
          'Cy''s beat stopped for 76 s: the next call sweeps her and the slot is Ada''s');
reset role;
select is(tests.places(), 1::bigint, 'Cy''s place is gone');
select tests.act_as(:'cy');
select is((select row(state, mine)::text from public.import_slot_beat('device:cy', 99)), '(none,f)', 'her late beat finds no place, and does not make one');
reset role;
select is(tests.places(), 1::bigint, 'still one place');

-- 74 s without a beat is no reason to lose a place; the beat itself renews it.
select tests.beat_a_while_ago(:'ada', 74);
select tests.act_as(:'cy');
select is((select state from public.import_slot_take('device:cy', 10)), 'waiting', 'Cy waits again');
reset role;
select is(tests.runners(), 1::bigint, 'Ada, 74 s without a beat, still has the slot');
select tests.act_as(:'ada');
select is((select state from public.import_slot_beat('device:ada')), 'running', 'a beat after a long gap renews it');
reset role;
select ok(tests.beat_at(:'ada') > clock_timestamp() - interval '5 seconds', 'to now');

-- A waiting one that stops polling drops out, too.
select tests.stop_beating(:'cy');
select tests.act_as(:'ada');
select is((select row(state, ahead)::text from public.import_slot_beat('device:ada')), '(running,0)', 'a waiting place that stopped polling is swept');
reset role;
select is(tests.places(), 1::bigint, 'leaving only Ada''s');

-- A place the device lost can be taken again: at the back, or the slot when nobody has it.
select tests.act_as(:'ada');
select is((select state from public.import_slot_leave('device:ada')), 'none', 'Ada leaves');
select is((select row(state, mine)::text from public.import_slot_take('device:ada', 5)), '(running,t)', 'and, with nobody running, takes the slot straight away');
reset role;

-- -------------------------------------------------- only one runner, ever

select throws_ok($$select tests.second_runner('$$ || :'bo' || $$')$$, '23505', null, 'the table itself refuses a second runner');

-- ------------------------------------------------------ the account going

delete from auth.users where id = :'ada';
select is(tests.places(), 0::bigint, 'the place goes with the account');
select tests.act_as(:'bo');
select is((select row(state, mine)::text from public.import_slot_take('device:bo', 1)), '(running,t)', 'and the slot is free for the next');
reset role;

select * from finish();
rollback;
