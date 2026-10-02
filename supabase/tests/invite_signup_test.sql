-- The invite gate and the privacy of accounts, at the database boundary:
--   supabase test db
--
-- What a broken client must not be able to talk its way past: no account
-- without a live invite, no invite used more often than it allows, nothing
-- spent on a signup nobody finishes, and no member able to read the code table
-- or anybody else's account. Nothing here counts the rows of a table — the
-- local database holds the seed and whatever else a developer left in it — it
-- asks about the specific rows this test made.

begin;
select plan(39);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses, expires_at) values
  ('T-GOOD',    'usable',    5, null),
  ('T-LASTONE', 'one left',  1, null),
  ('T-OLD',     'expired',   5, now() - interval '1 day');
insert into public.invite_codes (code, label, max_uses, uses) values
  ('T-SPENT',   'used up',   2, 2);

-- Stands in for what GoTrue inserts; the trigger reads raw_user_meta_data.
-- Unconfirmed unless a test says so: an unconfirmed user is only half a signup,
-- because the invite is consumed and the account made when the address is
-- proved, not when the code is asked for.
create or replace function tests.signup(p_email text, p_meta jsonb,
                                        p_confirmed boolean default false)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, p_meta, case when p_confirmed then now() end, now(), now());
  return v_id;
end;
$$;

-- What a successful verifyOtp does to the row.
create or replace function tests.confirm(p_id uuid)
returns void language sql as $$
  update auth.users set email_confirmed_at = now() where id = p_id;
$$;

create or replace function tests.uses(p_code text)
returns integer language sql as $$
  select uses from public.invite_codes where code = p_code::citext;
$$;

-- ------------------------------------------------------- the pre-flight check

select is(public.invite_code_status('T-GOOD'), 'valid', 'a live code is valid');
select is(public.invite_code_status('t-good'), 'valid', 'codes are case-insensitive');
select is(public.invite_code_status('T-NOPE'), 'invalid', 'an unknown code is invalid');
select is(public.invite_code_status('T-OLD'), 'expired', 'an expired code says so');
select is(public.invite_code_status('T-SPENT'), 'exhausted', 'a used-up code says so');
select is(public.invite_code_status('   '), 'missing', 'a blank code is missing');
select is(public.invite_code_status(null), 'missing', 'and so is no code at all');

-- ------------------------------------------------------------- the signup gate

select throws_ok(
  $$ select tests.signup('mallory@example.com', '{}'::jsonb) $$,
  '23514', 'invite_code_required', 'a signup without a code is refused');

select throws_ok(
  $$ select tests.signup('mallory@example.com', '{"invite_code":"T-NOPE"}'::jsonb) $$,
  '23514', 'invite_code_invalid', 'a signup with an unknown code is refused');

select throws_ok(
  $$ select tests.signup('mallory@example.com', '{"invite_code":"T-OLD"}'::jsonb) $$,
  '23514', 'invite_code_expired', 'a signup with an expired code is refused');

select throws_ok(
  $$ select tests.signup('mallory@example.com', '{"invite_code":"T-SPENT"}'::jsonb) $$,
  '23514', 'invite_code_exhausted', 'a signup with a used-up code is refused');

select is((select count(*)::int from auth.users where email = 'mallory@example.com'), 0,
  'a refused signup leaves no auth user behind');

-- --------------------------------------------- asking for a code costs nothing

select tests.signup('ida@example.com', '{"invite_code":"T-GOOD"}'::jsonb) as ida_id \gset

select is((select count(*)::int from auth.users where id = :'ida_id'), 1,
  'a signup with a live code creates the auth user (GoTrue needs it to mail the code)');
select is(tests.uses('T-GOOD'), 0, 'but asking for a code consumes no invite use');
select is((select count(*)::int from public.accounts where id = :'ida_id'), 0,
  'and creates no account');

-- ------------------------------------------------- consumed on confirmation

select lives_ok(format($$ select tests.confirm(%L) $$, :'ida_id'),
  'proving the address finishes the signup');
select is(tests.uses('T-GOOD'), 1, 'the invite is consumed then, not before');
select is(
  (select invite_code_id from public.accounts where id = :'ida_id'),
  (select id from public.invite_codes where code = 'T-GOOD'),
  'the account records the invite it came in on');

update auth.users set email_confirmed_at = now() + interval '1 second' where id = :'ida_id';
select is(tests.uses('T-GOOD'), 1, 'confirming the same address again costs nothing more');

-- A user the seed or the dashboard creates is proved from the start: one step.
select tests.signup('olle@example.com', '{"invite_code":"T-GOOD"}'::jsonb, true) as olle_id \gset
select is(tests.uses('T-GOOD'), 2, 'an already-confirmed user is admitted on insert');
select is((select count(*)::int from public.accounts where id = :'olle_id'), 1,
  'with its account');

-- The last slot can go to somebody else while the mail sits unread, so the
-- judgement is made again at confirmation.
select tests.signup('late@example.com', '{"invite_code":"T-LASTONE"}'::jsonb) as late_id \gset
select tests.signup('first@example.com', '{"invite_code":"T-LASTONE"}'::jsonb) as first_id \gset
select tests.confirm(:'first_id'::uuid);

select throws_ok(format($$ select tests.confirm(%L) $$, :'late_id'),
  '23514', 'invite_code_exhausted', 'a code used up in between is refused at confirmation');
select is((select count(*)::int from public.accounts where id = :'late_id'), 0,
  'and the late signup gets no account');
select is(tests.uses('T-LASTONE'), 1, 'and the code is not over-used');

select throws_ok(
  $$ update public.invite_codes set uses = max_uses + 1 where code = 'T-GOOD' $$,
  '23514', null, 'the table itself refuses a code used more often than it allows');

-- --------------------------------------------------------- abandoned signups

select tests.signup('stale@example.com', '{"invite_code":"T-GOOD"}'::jsonb) as stale_id \gset
update auth.users set created_at = now() - interval '2 days' where id = :'stale_id';
select tests.signup('fresh@example.com', '{"invite_code":"T-GOOD"}'::jsonb) as fresh_id \gset

select public.purge_abandoned_signups();

select is((select count(*)::int from auth.users where id = :'stale_id'), 0,
  'an address never proved is swept up after a day');
select is((select count(*)::int from auth.users where id = :'fresh_id'), 1,
  'one from this hour is left alone');
select is((select count(*)::int from auth.users where id = :'ida_id'), 1,
  'and a member who proved the address is never touched');

-- ------------------------------------------------------ RLS: acting as a member

-- Read the ids while still privileged, then drop to the member role: an
-- authenticated member has no rights on auth.users.
select set_config('request.jwt.claims',
  json_build_object('sub', :'ida_id', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from public.accounts where id = auth.uid()), 1,
  'a member can read her own account');

select is((select count(*)::int from public.accounts where id = :'olle_id'), 0,
  'and not somebody else''s');

select throws_ok(
  $$ select count(*) from public.invite_codes $$,
  '42501', 'permission denied for table invite_codes',
  'a member cannot read the invite code table');

select throws_ok(
  $$ insert into public.accounts (id) values (gen_random_uuid()) $$,
  '42501', null, 'a member cannot make an account for herself or anyone else');

select throws_ok(
  $$ update public.accounts set invite_code_id = null where id = auth.uid() $$,
  '42501', null, 'a member cannot rewrite the invite she came in on');

select throws_ok(
  $$ delete from public.accounts where id = auth.uid() $$,
  '42501', null, 'a member cannot delete her account row');

select throws_ok(
  $$ select public.create_invite_code(5) $$,
  '42501', null, 'a member cannot mint invite codes');

select throws_ok(
  $$ select public.purge_abandoned_signups() $$,
  '42501', null, 'nor sweep up other people''s unfinished signups');

select is(public.invite_code_status('T-GOOD'), 'valid',
  'but a member can still ask whether a code is usable');

-- ------------------------------------------------------ RLS: a visitor, no JWT

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select throws_ok(
  $$ select count(*) from public.accounts $$,
  '42501', 'permission denied for table accounts', 'a visitor cannot read accounts at all');

-- --------------------------------------------------------------- the owner

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select is(
  (select max_uses from public.create_invite_code(7, now() + interval '3 days', 'test', 'T-MINTED')),
  7, 'the service role can mint a code with a use limit and an expiry');

reset role;
select * from finish();
rollback;
