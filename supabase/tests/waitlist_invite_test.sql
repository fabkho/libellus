-- Inviting from the waitlist (issue #171, 20261013010000_waitlist_invite.sql):
--   supabase test db
--
-- `owner_waitlist_prepare_invite(id)` is what the owner's Invite button asks for (through the
-- `waitlist-invite` edge function, with her session): the entry's address and a one-use invite
-- code for it, valid 14 days. The entry keeps its code and gets the same one back while it is
-- unused and unexpired; a used, expired or deleted code is replaced by a new one. The address never
-- goes into the code's label. Only the instance owner may (`not_owner` otherwise; a signed-out
-- caller is not even granted it); an unknown id raises `waitlist_entry_not_found`. Preparing never
-- marks the entry invited, and members still read nothing of `invite_codes`. Assertions ask about
-- the rows this test made (addresses end in @invite.pgtap.test).

begin;
select plan(35);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-WLINV', 'waitlist invite test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_build_object('invite_code', 'T-WLINV'), now(), now(), now());
  return v_id;
end;
$$;

create or replace function tests.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{}', true);
  execute 'set local role authenticated';
end;
$$;

create or replace function tests.act_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.headers', '{}', true);
  execute 'set local role anon';
end;
$$;

create or replace function tests.name_owner(p_id uuid)
returns void language sql security definer as $$
  update private.instance_owner set owner_id = p_id
$$;

-- Past the API's walls: an entry's id, its code and whether it is invited, as the schema's owner sees them.
create or replace function tests.entry_id(p_email text)
returns uuid language sql security definer as $$
  select w.id from private.waitlist w where w.email = p_email::extensions.citext
$$;

create or replace function tests.entry_code(p_email text)
returns public.invite_codes language sql security definer as $$
  select c.* from private.waitlist w join public.invite_codes c on c.id = w.invite_code_id
   where w.email = p_email::extensions.citext
$$;

create or replace function tests.entry_invited(p_email text)
returns timestamptz language sql security definer as $$
  select w.invited_at from private.waitlist w where w.email = p_email::extensions.citext
$$;

create or replace function tests.set_code(p_code text, p_uses integer, p_expires_at timestamptz)
returns void language sql security definer as $$
  update public.invite_codes set uses = p_uses, expires_at = p_expires_at where code = p_code::extensions.citext
$$;

create or replace function tests.drop_code(p_code text)
returns void language sql security definer as $$
  delete from public.invite_codes where code = p_code::extensions.citext
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create temp table ids on commit drop as
  select tests.member('wli-ada@libellus.test') as ada,
         tests.member('wli-bo@libellus.test') as bo;
grant select on ids to public;
-- The codes this test got back, by name.
create temp table got (name text primary key, code text, expires_at timestamptz, email text) on commit drop;
grant all on got to public;

insert into private.waitlist (email, consent_text_version)
values ('first@invite.pgtap.test', '2026-10'), ('second@invite.pgtap.test', '2026-10');

-- ----------------------------------------------------------------- what is built

select has_column('private', 'waitlist', 'invite_code_id', 'an entry keeps the code minted for it');
select fk_ok('private', 'waitlist', 'invite_code_id', 'public', 'invite_codes', 'id', 'which is an invite code');
select ok(has_function_privilege('authenticated', 'public.owner_waitlist_prepare_invite(uuid)', 'execute'),
          'a signed-in member may call it (the owner check is inside)');
select ok(not has_function_privilege('anon', 'public.owner_waitlist_prepare_invite(uuid)', 'execute'), 'anon is not granted it');
select ok((select prosecdef from pg_proc where oid = 'public.owner_waitlist_prepare_invite(uuid)'::regprocedure),
          'it runs as its owner');
select ok((select 'search_path=""' = any (proconfig) from pg_proc where oid = 'public.owner_waitlist_prepare_invite(uuid)'::regprocedure),
          'with an empty search path');

-- ---------------------------------------------------------------- not the owner

select tests.name_owner(null);
select tests.act_as((select ada from ids));
select throws_ok(format('select * from public.owner_waitlist_prepare_invite(%L)', tests.entry_id('first@invite.pgtap.test')),
                 '42501', 'not_owner', 'while nobody is named, nobody gets a code');
reset role;

select tests.name_owner((select ada from ids));
select tests.act_as((select bo from ids));
select throws_ok(format('select * from public.owner_waitlist_prepare_invite(%L)', tests.entry_id('first@invite.pgtap.test')),
                 '42501', 'not_owner', 'a member who is not the owner is refused');
select throws_ok($$select * from public.invite_codes$$, '42501', null, 'and still reads no invite code');
reset role;
select tests.act_anon();
select throws_ok(format('select * from public.owner_waitlist_prepare_invite(%L)', tests.entry_id('first@invite.pgtap.test')),
                 '42501', null, 'a signed-out caller may not even call it');
reset role;
select is((tests.entry_code('first@invite.pgtap.test')).id, null, 'none of them minted a code');

-- ------------------------------------------------------------------- the owner

select tests.act_as((select ada from ids));

select throws_ok($$select * from public.owner_waitlist_prepare_invite(gen_random_uuid())$$,
                 'P0002', 'waitlist_entry_not_found', 'an id that is no entry is refused, and says so');

insert into got select 'first', p.code, p.expires_at, p.email
  from public.owner_waitlist_prepare_invite(tests.entry_id('first@invite.pgtap.test')) p;
select is((select email from got where name = 'first'), 'first@invite.pgtap.test', 'the owner gets the entry''s address');
select ok((select code from got where name = 'first') ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$', 'and a fresh code, XXXX-XXXX');
select is((select expires_at from got where name = 'first'), now() + interval '14 days', 'valid for 14 days');
reset role;

select is((tests.entry_code('first@invite.pgtap.test')).code::text, (select code from got where name = 'first'),
          'the entry keeps the code');
select is((tests.entry_code('first@invite.pgtap.test')).max_uses, 1, 'one use');
select is((tests.entry_code('first@invite.pgtap.test')).uses, 0, 'not spent');
select is((tests.entry_code('first@invite.pgtap.test')).label, 'waitlist', 'labelled waitlist');
select ok(position('invite.pgtap.test' in coalesce((tests.entry_code('first@invite.pgtap.test')).label, '')) = 0,
          'and the address is not in the label');
select is(tests.entry_invited('first@invite.pgtap.test'), null, 'preparing does not mark the entry invited');

-- The same entry again: the same code, nothing new minted.
select tests.act_as((select ada from ids));
select is((select p.code from public.owner_waitlist_prepare_invite(tests.entry_id('first@invite.pgtap.test')) p),
          (select code from got where name = 'first'), 'asking again reuses the usable code');
select is((select count(*)::int from got g join public.owner_waitlist_prepare_invite(tests.entry_id('second@invite.pgtap.test')) p
            on p.code = g.code), 0, 'another entry gets a code of its own');
reset role;
select isnt((tests.entry_code('second@invite.pgtap.test')).id, (tests.entry_code('first@invite.pgtap.test')).id, 'kept on that entry');

-- Expired: a new one.
select tests.set_code((select code from got where name = 'first'), 0, now() - interval '1 minute');
select tests.act_as((select ada from ids));
insert into got select 'after expiry', p.code, p.expires_at, p.email
  from public.owner_waitlist_prepare_invite(tests.entry_id('first@invite.pgtap.test')) p;
reset role;
select isnt((select code from got where name = 'after expiry'), (select code from got where name = 'first'),
            'an expired code is replaced by a new one');
select is((tests.entry_code('first@invite.pgtap.test')).code::text, (select code from got where name = 'after expiry'),
          'which the entry keeps from now on');
select is((select expires_at from got where name = 'after expiry'), now() + interval '14 days', 'again for 14 days');

-- Used (she signed up with it): a new one.
select tests.set_code((select code from got where name = 'after expiry'), 1, now() + interval '1 day');
select tests.act_as((select ada from ids));
insert into got select 'after use', p.code, p.expires_at, p.email
  from public.owner_waitlist_prepare_invite(tests.entry_id('first@invite.pgtap.test')) p;
reset role;
select isnt((select code from got where name = 'after use'), (select code from got where name = 'after expiry'),
            'a spent code is replaced by a new one');

-- Deleted (the operator cleaned up her codes): the entry forgets it, and the next Invite mints again.
select tests.drop_code((select code from got where name = 'after use'));
select is((tests.entry_code('first@invite.pgtap.test')).id, null, 'a deleted code leaves the entry without one');
select tests.act_as((select ada from ids));
insert into got select 'after delete', p.code, p.expires_at, p.email
  from public.owner_waitlist_prepare_invite(tests.entry_id('first@invite.pgtap.test')) p;
reset role;
select ok((select code from got where name = 'after delete') is not null
          and (select code from got where name = 'after delete') <> (select code from got where name = 'after use'),
          'and the next Invite mints a new one');

-- The code is a real invite: it lets one address in.
select tests.set_code((select code from got where name = 'after delete'), 0, now() + interval '14 days');
select lives_ok(format(
  $$insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'wli-new@libellus.test', jsonb_build_object('invite_code', %L), now(), now(), now())$$,
  (select code from got where name = 'after delete')), 'the code lets one address sign up');
select is((tests.entry_code('first@invite.pgtap.test')).uses, 1, 'and is spent by it');
select throws_ok(format(
  $$insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'wli-second@libellus.test', jsonb_build_object('invite_code', %L), now(), now(), now())$$,
  (select code from got where name = 'after delete')), null, null, 'a second address is refused it');

-- Marking stays what it was: the function calls it after the mail went out.
select tests.act_as((select ada from ids));
select is(public.owner_waitlist_set_invited(array[tests.entry_id('first@invite.pgtap.test')]), 1, 'the entry is then marked invited');
reset role;
select ok(tests.entry_invited('first@invite.pgtap.test') is not null, 'and says when');

select * from finish();
rollback;
