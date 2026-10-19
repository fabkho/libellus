-- The import queue and devices (supabase test db): the same member from the same device takes her place back
-- at once after the app was closed and opened again (a new holder, the same device id); another device of hers
-- is told her import runs elsewhere and keeps the 75 s expiry. See 20261031010000_import_queue_device.sql.

begin;
select plan(17);

create schema if not exists tests;
insert into public.invite_codes (code, label, max_uses) values ('T-QDEV', 'import queue device test', 10);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
          jsonb_build_object('invite_code', 'T-QDEV'), now(), now(), now());
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
create or replace function tests.place(p_member uuid)
returns text language sql security definer as $$
  select concat_ws(',', holder, device, (started_at is not null)::text) from public.import_queue where member_id = p_member
$$;
create or replace function tests.joined_at(p_member uuid)
returns timestamptz language sql security definer as $$ select joined_at from public.import_queue where member_id = p_member $$;
create or replace function tests.beat_a_while_ago(p_member uuid, p_seconds integer)
returns void language sql security definer as $$
  update public.import_queue set beat_at = clock_timestamp() - make_interval(secs => p_seconds) where member_id = p_member
$$;
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

select tests.member('ada@qdev.pgtap.test') as ada \gset
select tests.member('bo@qdev.pgtap.test') as bo \gset

select has_column('public', 'import_queue', 'device', 'a place knows its device');
select ok(has_function_privilege('authenticated', 'public.import_slot_take(text, integer, text)', 'execute')
          and not has_function_privilege('anon', 'public.import_slot_take(text, integer, text)', 'execute'),
          'members take a place, visitors do not');
select is((select count(*)::int from pg_proc where proname = 'import_slot_take' and pronamespace = 'public'::regnamespace), 1,
          'one take function, no old overload left');

-- Ada runs on her phone.
select tests.act_as(:'ada');
select is((select row(state, mine, ahead)::text from public.import_slot_take('device:run-1', 100, 'dev-phone')), '(running,t,0)', 'Ada has the slot on her phone');
select is(tests.place(:'ada'), 'device:run-1,dev-phone,true', 'the place records the run and the device');
reset role;
select tests.beat_a_while_ago(:'ada', 60);

-- Her app was closed and opened again on the same phone: a new run, the same device.
select tests.act_as(:'ada');
select is((select row(state, mine, ahead)::text from public.import_slot_take('device:run-2', 60, 'dev-phone')), '(running,t,0)',
          'the same device in a new run has the slot back at once (no 75 s)');
reset role;
select is(tests.place(:'ada'), 'device:run-2,dev-phone,true', 'the place is the new run''s, still running');
select tests.act_as(:'ada');
select is((select mine from public.import_slot_beat('device:run-1')), false, 'the old run''s beat is told the place is no longer its own, so it stops');
select is((select mine from public.import_slot_beat('device:run-2')), true, 'the new run beats its own place');
reset role;

-- Her tablet is another device: told her import runs elsewhere, the place is not taken.
select tests.act_as(:'ada');
select is((select row(state, mine, ahead)::text from public.import_slot_take('device:tablet-run', 10, 'dev-tablet')), '(running,f,0)',
          'another device of hers is told her import runs elsewhere');
reset role;
select is(tests.place(:'ada'), 'device:run-2,dev-phone,true', 'and the place stays the phone''s');

-- The phone is gone for good: the tablet takes the slot only after the place expired (75 s), as before.
select tests.beat_a_while_ago(:'ada', 76);
select tests.act_as(:'ada');
select is((select row(state, mine, ahead)::text from public.import_slot_take('device:tablet-run', 10, 'dev-tablet')), '(running,t,0)', 'after 75 s the tablet takes the slot');
reset role;

-- A place waiting in line is taken over the same way, and keeps its turn.
select tests.act_as(:'bo');
select is((select state from public.import_slot_take('device:bo-1', 50, 'dev-bo')), 'waiting', 'Bo waits behind Ada');
reset role;
select tests.joined_at(:'bo') as bo_turn \gset
select tests.act_as(:'bo');
select is((select row(state, mine, ahead)::text from public.import_slot_take('device:bo-2', 50, 'dev-bo')), '(waiting,t,1)', 'Bo''s app was reopened: the same place, new holder');
reset role;
select is(tests.joined_at(:'bo') = :'bo_turn'::timestamptz, true, 'with its turn kept');

-- No device known (an older app): only the same run reclaims.
select tests.act_as(:'bo');
select is((select mine from public.import_slot_take('device:bo-3', 50)), false, 'without a device id another run does not take the place');
select throws_ok($$select * from public.import_slot_take('device:x', 1, repeat('d', 65))$$, '22023', 'device_invalid', 'a device id over 64 characters is refused');
reset role;

select * from finish();
rollback;
