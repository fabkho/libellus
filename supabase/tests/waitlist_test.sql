-- The waitlist on a reading page (issue #171):
--   supabase test db
--
-- A signed-out visitor leaves her address through `join_waitlist(email, token, website)`
-- and nothing else: no member reads, writes or deletes the table, the API cannot even
-- see it. The address is trimmed, compared without regard to case and checked for its
-- shape (`email_invalid`); the same address again, a dead token and a filled honeypot all
-- answer `joined`, so nothing says what was already there; a caller is limited to 5 new
-- entries an hour, all callers to 100 (`rate_limited`), the limits before the list is
-- looked at; the page's token only finds whose page it was and is never stored. Only the
-- instance owner reads the list, marks entries invited and deletes one, and gets
-- `not_owner` otherwise. Assertions ask about the rows this test made (its addresses end in
-- @waitlist.pgtap.test), never about how many rows a table holds.

begin;
select plan(72);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-WLIST', 'waitlist test', 5);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-WLIST', 'name', p_name)), now(), now(), now());
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

-- A signed-out visitor at an address (the first one of x-forwarded-for, as PostgREST hands it over).
create or replace function tests.act_anon(p_address text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.headers', json_build_object('x-forwarded-for', p_address || ', 10.0.0.1')::text, true);
  execute 'set local role anon';
end;
$$;

create or replace function tests.name_owner(p_id uuid)
returns void language sql security definer as $$
  update private.instance_owner set owner_id = p_id
$$;

-- Past the API's walls: the row of an address, as the owner of the schema sees it.
create or replace function tests.entry(p_email text)
returns table (email text, source text, source_member_id uuid, consent_text_version text, invited_at timestamptz, created_at timestamptz)
language sql security definer as $$
  select w.email::text, w.source, w.source_member_id, w.consent_text_version, w.invited_at, w.created_at
    from private.waitlist w where w.email = p_email::extensions.citext
$$;

create or replace function tests.entries(p_like text)
returns bigint language sql security definer as $$
  select count(*) from private.waitlist w where w.email::text like p_like
$$;

create or replace function tests.entry_id(p_email text)
returns uuid language sql security definer as $$
  select w.id from private.waitlist w where w.email = p_email::extensions.citext
$$;

-- Everything the table and the limit table hold that could be the token, the address or the caller's address.
create or replace function tests.everything_stored()
returns text language sql security definer as $$
  select coalesce((select string_agg(w::text, ' ') from private.waitlist w where w.email::text like '%@waitlist.pgtap.test'), '')
      || coalesce((select string_agg(j::text, ' ') from private.waitlist_joins j), '')
$$;

-- This many joins of everybody in the last hour, made up.
create or replace function tests.crowd(p_count integer)
returns void language sql security definer as $$
  insert into private.waitlist_joins (caller_key) select 'crowd:' || g from generate_series(1, p_count) g
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create temp table ids on commit drop as
  select tests.member('wl-ada@libellus.test', 'Ada') as ada,
         tests.member('wl-bo@libellus.test') as bo;
grant select on ids to public;
create temp table tokens (name text primary key, token text) on commit drop;
grant all on tokens to public;

-- Ada's reading page is on; Bo's has never been.
select tests.act_as((select ada from ids));
insert into tokens select 'ada', token from public.set_reading_page(true);
reset role;
select ok((select token from tokens where name = 'ada') ~ '^[A-Za-z0-9_-]{22}$', 'Ada''s page has a token');

-- ----------------------------------------------------------------- what is built

select ok(has_function_privilege('anon', 'public.join_waitlist(text, text, text)', 'execute'), 'anon may join (the page is public)');
select ok(has_function_privilege('authenticated', 'public.join_waitlist(text, text, text)', 'execute'), 'and so may a signed-in member');
select ok(not has_function_privilege('anon', 'public.owner_waitlist()', 'execute'), 'anon is not granted the owner''s list');
select ok(not has_function_privilege('anon', 'public.owner_waitlist_set_invited(uuid[], boolean)', 'execute'), 'nor marking');
select ok(not has_function_privilege('anon', 'public.owner_waitlist_delete(uuid)', 'execute'), 'nor deleting');
select ok(not has_table_privilege('anon', 'private.waitlist', 'select'), 'anon has no grant on the table');
select ok(not has_table_privilege('authenticated', 'private.waitlist', 'select'), 'nor does a member');
select ok(not has_function_privilege('anon', 'private.waitlist_email_ok(text)', 'execute'), 'the shape check is not callable from the API');
select ok((select relrowsecurity from pg_class where oid = 'private.waitlist'::regclass), 'row level security is on for the list');
select ok((select relrowsecurity from pg_class where oid = 'private.waitlist_joins'::regclass), 'and for the limits');

-- ---------------------------------------------------------------------- joining

select tests.act_anon('203.0.113.7');

select is(public.join_waitlist('  New.Reader@Waitlist.PGTAP.test ', (select token from tokens where name = 'ada')), 'joined',
          'a visitor of Ada''s page joins, her address trimmed');
select is((select email from tests.entry('new.reader@waitlist.pgtap.test')), 'new.reader@waitlist.pgtap.test',
          'and kept in lower case');
select is((select source from tests.entry('new.reader@waitlist.pgtap.test')), 'reading_page', 'from a reading page');
select is((select source_member_id from tests.entry('new.reader@waitlist.pgtap.test')), (select ada from ids),
          'the member is the page''s, found by the token on the server');
select ok((select consent_text_version from tests.entry('new.reader@waitlist.pgtap.test')) <> '', 'with the version of the wording she saw');
select ok((select invited_at from tests.entry('new.reader@waitlist.pgtap.test')) is null, 'not invited yet');

select is(public.join_waitlist('NEW.reader@waitlist.pgtap.test', (select token from tokens where name = 'ada')), 'joined',
          'the same address again, in other letters, answers the same');
select is(tests.entries('new.reader@waitlist.pgtap.test'), 1::bigint, 'and is still one entry');

select is(public.join_waitlist('someone@waitlist.pgtap.test', 'not-a-token'), 'joined', 'a token that is nothing joins all the same');
select is((select source_member_id from tests.entry('someone@waitlist.pgtap.test')), null, 'from no member');
select is(public.join_waitlist('nobody@waitlist.pgtap.test'), 'joined', 'without a token too');
select is(public.join_waitlist('wrongpage@waitlist.pgtap.test', repeat('A', 22)), 'joined', 'and with a well-formed token no page has');
select is((select source_member_id from tests.entry('wrongpage@waitlist.pgtap.test')), null, 'from no member, again');

select ok(position((select token from tokens where name = 'ada') in tests.everything_stored()) = 0,
          'the page''s token is stored nowhere');
select ok(position('203.0.113.7' in tests.everything_stored()) = 0, 'and neither is the caller''s address');

-- Invalid addresses.
select throws_ok($$select public.join_waitlist(null)$$, '22023', 'email_invalid', 'no address is refused');
select throws_ok($$select public.join_waitlist('   ')$$, '22023', 'email_invalid', 'blanks are refused');
select throws_ok($$select public.join_waitlist('no-at-sign.waitlist.pgtap.test')$$, '22023', 'email_invalid', 'an address without @ is refused');
select throws_ok($$select public.join_waitlist('a@b@waitlist.pgtap.test')$$, '22023', 'email_invalid', 'two @ are refused');
select throws_ok($$select public.join_waitlist('a@nodot')$$, '22023', 'email_invalid', 'a domain without a dot is refused');
select throws_ok($$select public.join_waitlist('a b@waitlist.pgtap.test')$$, '22023', 'email_invalid', 'a space inside is refused');
select throws_ok($$select public.join_waitlist('a@waitlist..test')$$, '22023', 'email_invalid', 'an empty label is refused');
select throws_ok($$select public.join_waitlist('<a>@waitlist.pgtap.test')$$, '22023', 'email_invalid', 'angle brackets are refused');
select throws_ok($$select public.join_waitlist(repeat('a', 65) || '@waitlist.pgtap.test')$$, '22023', 'email_invalid', 'a local part over 64 is refused');
select throws_ok($$select public.join_waitlist(repeat('a', 250) || '@b.test')$$, '22023', 'email_invalid', 'an address over 254 is refused');
select is(tests.entries('%@nodot'), 0::bigint, 'and none of them was kept');

-- The honeypot.
select is(public.join_waitlist('bot@waitlist.pgtap.test', null, 'https://spam.example'), 'joined', 'a filled honeypot answers joined');
select is(tests.entries('bot@waitlist.pgtap.test'), 0::bigint, 'and stores nothing');
select is(public.join_waitlist('human@waitlist.pgtap.test', null, '  '), 'joined', 'an honeypot of blanks is an empty one');
select is(tests.entries('human@waitlist.pgtap.test'), 1::bigint, 'and the address is kept');

-- The limits: this caller made five new entries above (the honeypot and the bad addresses never counted), so a sixth is refused.
select throws_ok($$select public.join_waitlist('sixth@waitlist.pgtap.test')$$, '54000', 'rate_limited', 'a caller who made five entries in the hour is refused a sixth');
reset role;

-- A fresh caller: five, then refused; duplicates and bad addresses never counted.
select tests.act_anon('198.51.100.20');
select is((select count(*)::int from generate_series(1, 5) g
            where public.join_waitlist('limit' || g || '@waitlist.pgtap.test') = 'joined'), 5, 'one caller makes five entries');
select throws_ok($$select public.join_waitlist('limit6@waitlist.pgtap.test')$$, '54000', 'rate_limited', 'and the sixth is refused');
select throws_ok($$select public.join_waitlist('limit1@waitlist.pgtap.test')$$, '54000', 'rate_limited',
                 'an address already there is refused too, so the refusal never says whether it was');
select is(tests.entries('limit6@waitlist.pgtap.test'), 0::bigint, 'the sixth was not kept');
select tests.act_anon('198.51.100.21');
select is(public.join_waitlist('limit6@waitlist.pgtap.test'), 'joined', 'another address has its own limit');
select is(public.join_waitlist('limit6@waitlist.pgtap.test'), 'joined', 'and its repeats cost nothing');
reset role;

-- All callers together: 100 an hour.
select tests.crowd(100);
select tests.act_anon('192.0.2.200');
select throws_ok($$select public.join_waitlist('crowd@waitlist.pgtap.test')$$, '54000', 'rate_limited', 'over 100 in the hour from everyone, a new caller is refused');
reset role;
delete from private.waitlist_joins where caller_key like 'crowd:%';

-- ---------------------------------------------------------------- nobody reads it

select tests.act_as((select bo from ids));
select throws_ok($$select * from private.waitlist$$, '42501', null, 'a member cannot read the table');
select throws_ok($$delete from private.waitlist$$, '42501', null, 'cannot delete from it');
select throws_ok($$insert into private.waitlist (email, consent_text_version) values ('own@waitlist.pgtap.test', 'x')$$, '42501', null, 'nor write to it');
reset role;
select tests.act_anon('203.0.113.9');
select throws_ok($$select * from private.waitlist$$, '42501', null, 'neither can a signed-out caller');
reset role;

-- ---------------------------------------------------------------- not the owner

-- Nobody is named: nobody may.
select tests.name_owner(null);
select tests.act_as((select ada from ids));
select throws_ok($$select * from public.owner_waitlist()$$, '42501', 'not_owner', 'while nobody is named, no member reads the list');
reset role;

-- Ada is named; Bo is not.
select tests.name_owner((select ada from ids));
select tests.act_as((select bo from ids));
select throws_ok($$select * from public.owner_waitlist()$$, '42501', 'not_owner', 'a member who is not the owner is refused the list');
select throws_ok($$select public.owner_waitlist_set_invited(array[gen_random_uuid()])$$, '42501', 'not_owner', 'and marking');
select throws_ok($$select public.owner_waitlist_delete(gen_random_uuid())$$, '42501', 'not_owner', 'and deleting');
reset role;
select tests.act_anon('203.0.113.9');
select throws_ok($$select * from public.owner_waitlist()$$, '42501', null, 'a signed-out caller may not even call the list');
reset role;

-- ------------------------------------------------------------------- the owner

select tests.act_as((select ada from ids));

select is((select count(*)::int from public.owner_waitlist() where email like '%@waitlist.pgtap.test'), 11,
          'the owner reads the list: this test''s entries');
select is((select member_name from public.owner_waitlist() where email = 'new.reader@waitlist.pgtap.test'), 'Ada',
          'with the first name of the member whose page it was');
select is((select member_name from public.owner_waitlist() where email = 'someone@waitlist.pgtap.test'), null, 'and none for a join from no page');
select is((select source from public.owner_waitlist() where email = 'new.reader@waitlist.pgtap.test'), 'reading_page', 'the source');
select ok(pg_get_function_result('public.owner_waitlist()'::regprocedure) !~ 'uuid\[|source_member|token',
          'the list carries no member id and no token');

select is(public.owner_waitlist_set_invited(array[tests.entry_id('new.reader@waitlist.pgtap.test'), gen_random_uuid()]), 1,
          'she marks an entry invited (an id that is nothing finds none)');
select ok((select invited_at from public.owner_waitlist() where email = 'new.reader@waitlist.pgtap.test') is not null, 'and it says when');
select is(public.owner_waitlist_set_invited(array[tests.entry_id('new.reader@waitlist.pgtap.test')], false), 1, 'marking it waiting again');
select ok((select invited_at from public.owner_waitlist() where email = 'new.reader@waitlist.pgtap.test') is null, 'puts it back');

select is(public.owner_waitlist_delete(tests.entry_id('human@waitlist.pgtap.test')), true, 'she deletes an entry');
select is(public.owner_waitlist_delete(gen_random_uuid()), false, 'and one that is not there says false');
select is((select count(*)::int from public.owner_waitlist() where email = 'human@waitlist.pgtap.test'), 0, 'the entry is gone from the list');
reset role;

-- The same address may ask again once she has been forgotten; and a member's account going leaves the entry, from no one.
select tests.act_anon('203.0.113.50');
select is(public.join_waitlist('human@waitlist.pgtap.test'), 'joined', 'a deleted address can join again');
reset role;
delete from auth.users where id = (select ada from ids);
select is((select source_member_id from tests.entry('new.reader@waitlist.pgtap.test')), null,
          'when Ada''s account goes, her page''s entries stay, from no one');

select * from finish();
rollback;
