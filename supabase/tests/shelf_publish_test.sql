-- The shelf follows the owner's reads (issue #110):
--   supabase test db
--
-- A change to the owner's Library the shelf shows (an entry, a read; not its progress) sends
-- fabkho/regal a `repository_dispatch` through pg_net, at most once per ten
-- minutes; a change inside the ten minutes is owed and sent by the next
-- `shelf_publish_dispatch()` after them (pg_cron, every five minutes). Nobody
-- else's changes send anything, nothing is sent without an owner, the Vault
-- token or pg_net, and a failing dispatch never fails the member's write.
--
-- Never calls out: the token and the send are replaced with stand-ins for the
-- length of this transaction, which rolls back (and a pg_net request queued in
-- a rolled-back transaction is never sent anyway). Time does not move inside a
-- transaction, so the ten minutes pass by moving the stored timestamps back.

begin;
select plan(36);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-SHELF', 'shelf publish test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-SHELF"}'::jsonb, now(), now(), now());
  return v_id;
end;
$$;

create or replace function tests.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select tests.member('owner@shelf.test') as owner_id \gset
select tests.member('guest@shelf.test') as guest_id \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------------- closed doors

select ok(not has_schema_privilege('authenticated', 'private', 'usage'),
  'members cannot reach the private schema');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'nor can anyone signed out');
select ok(not has_table_privilege('authenticated', 'private.shelf_publish', 'select'),
  'nor read who the owner is');
select ok(not has_function_privilege('authenticated', 'private.shelf_publish_dispatch()', 'execute')
      and not has_function_privilege('authenticated', 'private.shelf_publish_changed(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'private.shelf_publish_token()', 'execute')
      and not has_function_privilege('authenticated', 'private.shelf_publish_send(text, text, text)', 'execute'),
  'nor send a dispatch, or read the token, themselves');
select is((select count(*)::int from private.shelf_publish), 1, 'the settings are one row');
select throws_ok($$ insert into private.shelf_publish (id) values (false) $$, '23514', null,
  'and stay one row');
select throws_ok($$ update private.shelf_publish set min_interval = interval '1 minute' $$, '23514', null,
  'never more than one dispatch per ten minutes');

-- The real token: none here (no Vault secret), and the one in the Vault once it is there, with pg_net.
select is(private.shelf_publish_token(), null, 'no token without the Vault secret github_dispatch_token');
select vault.create_secret('vault-token-for-the-test', 'github_dispatch_token');
select is(private.shelf_publish_token(),
  case when to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then null
       else 'vault-token-for-the-test' end,
  'the token comes from the Vault, where pg_net can send it');
delete from vault.secrets where name = 'github_dispatch_token';

-- ------------------------------------------------------------------ stand-ins

create table tests.sent (token text, repository text, event_type text);
grant all on tests.sent to authenticated;

create or replace function private.shelf_publish_token()
returns text language sql as $$ select 'test-token'::text $$;

create or replace function private.shelf_publish_send(p_token text, p_repository text, p_event_type text)
returns bigint language plpgsql as $$
begin
  insert into tests.sent values (p_token, p_repository, p_event_type);
  return 4242;
end;
$$;

create or replace function tests.sent() returns int language sql security definer as $$
  select count(*)::int from tests.sent
$$;

-- Ten minutes later, as far as the stored timestamps can tell.
create or replace function tests.later(p_minutes int) returns void language sql security definer as $$
  update private.shelf_publish
     set last_changed_at = last_changed_at - make_interval(mins => p_minutes),
         last_dispatched_at = last_dispatched_at - make_interval(mins => p_minutes)
   where id
$$;

update private.shelf_publish
   set owner_id = null, last_changed_at = null, last_dispatched_at = null, last_request_id = null;

-- ------------------------------------------------------------------- no owner

select tests.act_as(:'owner_id');
select (public.add_to_library('{"title":"Piranesi","source":"apple","apple_id":"990000110001"}')).id as piranesi \gset
reset role;
select is(tests.sent(), 0, 'without an owner nothing is sent');
select is((select last_changed_at from private.shelf_publish), null, 'and nothing is noted');
select is(private.shelf_publish_dispatch(), 'off', 'the dispatch is off');

update private.shelf_publish set owner_id = :'owner_id';

-- ------------------------------------------------------------- someone else

select tests.act_as(:'guest_id');
select (public.add_to_library('{"title":"Kindred","source":"apple","apple_id":"990000110002"}', 'finished', null, current_date, 16)).id as kindred \gset
reset role;
select is(tests.sent(), 0, 'a member who is not the owner finishes a book: nothing is sent');
select is((select last_changed_at from private.shelf_publish), null, 'and nothing is noted');
select is(private.shelf_publish_changed(:'guest_id'), 'not_owner', 'their changes are not the owner’s');
select is(private.shelf_publish_changed(null), 'not_owner', 'nor are nobody’s');

-- ------------------------------------------------------------------ the owner

select tests.act_as(:'owner_id');
select lives_ok(format($$ select public.start_reading(%L, current_date) $$, :'piranesi'),
  'the owner starts a book');
reset role;
select is(tests.sent(), 1, 'which sends one dispatch');
select results_eq($$ select token, repository, event_type from tests.sent $$,
  $$ values ('test-token', 'fabkho/regal', 'libellus-changed') $$,
  'to fabkho/regal, as libellus-changed, with the Vault token');
select results_eq(
  $$ select last_changed_at = now(), last_dispatched_at = now(), last_request_id from private.shelf_publish $$,
  $$ values (true, true, 4242::bigint) $$,
  'and notes the change, the dispatch and its request');

select tests.act_as(:'owner_id');
select (public.add_to_library('{"title":"Ruin","source":"apple","apple_id":"990000110003"}')).id as ruin \gset
reset role;
select is(tests.sent(), 1, 'more changes in the same moment send nothing more');

-- Five minutes on: progress is not a change the shelf shows (finished books only).
select tests.later(5);
select last_changed_at as noted_before from private.shelf_publish \gset
select tests.act_as(:'owner_id');
select lives_ok(format($$ select public.update_progress(%L, 40) $$, :'piranesi'), 'five minutes later the owner logs progress');
reset role;
select is(tests.sent(), 1, 'which sends nothing');
select is((select last_changed_at from private.shelf_publish), :'noted_before'::timestamptz,
  'and notes no change');
select is(private.shelf_publish_dispatch(), 'up_to_date', 'so nothing is owed');

-- Finishing the book is one: inside the ten minutes it is debounced, and owed.
select tests.act_as(:'owner_id');
select lives_ok(format($$ select public.finish_reading(%L, current_date, 18, 'Statues.') $$, :'piranesi'),
  'the owner finishes the book');
reset role;
select is(tests.sent(), 1, 'which is inside the ten minutes: nothing is sent');
select ok((select last_changed_at from private.shelf_publish) > :'noted_before'::timestamptz, 'but the change is noted');
select is(private.shelf_publish_dispatch(), 'debounced', 'and owed, not yet due');

-- Ten minutes after the dispatch: the scheduled run sends what is owed, once.
select tests.later(5);
select is(private.shelf_publish_dispatch(), 'dispatched', 'ten minutes after the last dispatch, the owed one goes out');
select is(tests.sent(), 2, 'one more dispatch');
select is(private.shelf_publish_dispatch(), 'up_to_date', 'and then nothing is owed');

-- Removing a book is a change too.
select tests.later(10);
select tests.act_as(:'owner_id');
select lives_ok(format($$ select public.remove_from_library(%L) $$, :'ruin'), 'the owner removes a Book');
reset role;
select is(tests.sent(), 3, 'which sends a dispatch once the ten minutes are up');

-- --------------------------------------------------------------- never in the way

create or replace function private.shelf_publish_send(p_token text, p_repository text, p_event_type text)
returns bigint language plpgsql as $$
begin
  raise exception 'GitHub is down';
end;
$$;

select tests.later(10);
select tests.act_as(:'owner_id');
select lives_ok(format($$ select public.read_again(%L, current_date) $$, :'piranesi'),
  'a dispatch that fails does not fail the owner’s write');
reset role;
select ok((select last_dispatched_at < now() from private.shelf_publish),
  'and is not counted as sent, so the scheduled run tries again');

select * from finish();
rollback;
