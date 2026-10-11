-- Contact: messages from members (feedback):
--   supabase test db
--
-- A member inserts her own message (a bug, a feature request, something else) and nothing else:
-- not for another member, and no select, update or delete, not even of her own rows; a signed-out
-- caller touches nothing. The text is 10 to 2000 characters (blanks do not count), the kind one of
-- three, the context a JSON object of at most 4000 bytes; she cannot set the owner's columns
-- (handled_at, owner_note). At most 5 messages an hour and 20 a day per member, refused with
-- rate_limited (PT429). The owner, and only the owner, reads the inbox (feedback_list, newest first,
-- paged, with who wrote it) and marks a message handled; everyone else gets not_owner. The messages
-- go with the account (delete_my_account). Assertions ask about the rows this test made.

begin;
select plan(68);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-FEEDBACK', 'feedback test', 10);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-FEEDBACK', 'name', p_name)), now(), now(), now());
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

create or replace function tests.act_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end;
$$;

create or replace function tests.name_owner(p_id uuid)
returns void language sql security definer as $$
  update private.instance_owner set owner_id = p_id
$$;

-- Past the API's walls: the rows of a member, as the owner of the schema sees them.
create or replace function tests.rows_of(p_member uuid)
returns bigint language sql security definer as $$
  select count(*) from public.feedback where member_id = p_member
$$;

create or replace function tests.all_rows()
returns int language sql security definer as $$
  select count(*)::int from public.feedback
$$;

create or replace function tests.row_of(p_body text)
returns public.feedback language sql security definer as $$
  select * from public.feedback where body = p_body
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

select tests.member('ada@feedback.pgtap.test', 'Ada') as ada \gset
select tests.member('bo@feedback.pgtap.test') as bo \gset
select tests.member('cy@feedback.pgtap.test') as cy \gset
select tests.member('di@feedback.pgtap.test') as di \gset

-- ------------------------------------------------------------------ the shape

select has_table('public', 'feedback', 'the table is there');
select is((select relrowsecurity from pg_class where oid = 'public.feedback'::regclass), true, 'with row level security on');
select ok(not has_table_privilege('anon', 'public.feedback', 'select, insert, update, delete'), 'anon is granted nothing on it');
select ok(has_column_privilege('authenticated', 'public.feedback', 'body', 'insert')
          and not has_table_privilege('authenticated', 'public.feedback', 'select')
          and not has_table_privilege('authenticated', 'public.feedback', 'update')
          and not has_table_privilege('authenticated', 'public.feedback', 'delete'),
          'a member may insert and nothing else');
select ok(not has_column_privilege('authenticated', 'public.feedback', 'handled_at', 'insert')
          and not has_column_privilege('authenticated', 'public.feedback', 'owner_note', 'insert')
          and not has_column_privilege('authenticated', 'public.feedback', 'created_at', 'insert'),
          'and cannot write the owner''s columns');
select ok(not has_function_privilege('authenticated', 'private.feedback_rate_limit()', 'execute'), 'the rate limit trigger is closed to the API');
select ok(not has_function_privilege('anon', 'public.feedback_list(integer, timestamptz)', 'execute'), 'anon is not granted the owner''s inbox');
select ok(not has_function_privilege('anon', 'public.feedback_mark_handled(uuid, boolean)', 'execute'), 'nor marking');
select ok((select 'search_path=""' = any (proconfig) from pg_proc where oid = 'public.feedback_list(integer, timestamptz)'::regprocedure)
          and (select 'search_path=""' = any (proconfig) from pg_proc where oid = 'public.feedback_mark_handled(uuid, boolean)'::regprocedure)
          and (select 'search_path=""' = any (proconfig) from pg_proc where oid = 'private.feedback_rate_limit()'::regprocedure),
          'the owner''s functions and the trigger pin an empty search_path');

-- ------------------------------------------------------------ a member's own message

select tests.act_as(:'ada');

select lives_ok(
  $$insert into public.feedback (kind, body, context) values ('bug', 'The sheet will not close on my phone.', '{"route":"/profile","appVersion":"abc"}')$$,
  'Ada sends a bug; her id is filled in by the database');
select lives_ok(
  $$insert into public.feedback (member_id, kind, body) values (auth.uid(), 'feature', 'Please add a way to export my shelf.')$$,
  'a feature request with her own id given, and no context');
select lives_ok(
  $$insert into public.feedback (kind, body) values ('other', '<script>alert(1)</script> and a "quote" and a ''tick''')$$,
  'markup in the text is just text: stored as it is');
reset role;

select is(tests.rows_of(:'ada'), 3::bigint, 'all three are stored');
select is((tests.row_of('The sheet will not close on my phone.')).member_id, :'ada'::uuid, 'under her id');
select is((tests.row_of('Please add a way to export my shelf.')).context, '{}'::jsonb, 'a message without context has an empty one');
select is((tests.row_of('<script>alert(1)</script> and a "quote" and a ''tick''')).body,
          '<script>alert(1)</script> and a "quote" and a ''tick''', 'and the markup is kept byte for byte');
select ok((tests.row_of('The sheet will not close on my phone.')).handled_at is null
          and (tests.row_of('The sheet will not close on my phone.')).owner_note is null, 'a new message is not handled and has no note');

-- ------------------------------------------------------------ what a member cannot do

select tests.act_as(:'ada');
select throws_ok(
  format($$insert into public.feedback (member_id, kind, body) values (%L, 'bug', 'Pretending to be Bo, ten chars.')$$, :'bo'),
  '42501', null, 'Ada cannot write a message as Bo');
select throws_ok($$select * from public.feedback$$, '42501', null, 'she cannot read the table, not even her own rows');
select throws_ok($$update public.feedback set body = 'Edited after the fact, ten chars.'$$, '42501', null, 'cannot change a message');
select throws_ok($$delete from public.feedback$$, '42501', null, 'cannot delete one');
select throws_ok(
  $$insert into public.feedback (kind, body, handled_at) values ('bug', 'Marking myself as handled now.', now())$$,
  '42501', null, 'cannot set handled_at');
select throws_ok(
  $$insert into public.feedback (kind, body, owner_note) values ('bug', 'Writing a note for the owner.', 'x')$$,
  '42501', null, 'nor the owner''s note');
select throws_ok($$select * from public.feedback_list()$$, '42501', 'not_owner', 'she cannot read others'' messages through the owner''s inbox');
select throws_ok($$select public.feedback_mark_handled(gen_random_uuid())$$, '42501', 'not_owner', 'nor mark one');
reset role;

select tests.act_anon();
select throws_ok(
  $$insert into public.feedback (kind, body) values ('bug', 'I am not signed in at all, ten.')$$,
  '42501', null, 'a signed-out caller cannot send');
select throws_ok($$select * from public.feedback_list()$$, '42501', null, 'nor read the inbox');
reset role;

select is(tests.rows_of(:'ada'), 3::bigint, 'none of this changed her rows');
select is(tests.rows_of(:'bo'), 0::bigint, 'and Bo has none');

-- ------------------------------------------------------------ what a message must be

select tests.act_as(:'bo');
select throws_ok($$insert into public.feedback (kind, body) values ('bug', 'too short')$$, '23514', null, 'a text under 10 characters is refused');
select throws_ok($$insert into public.feedback (kind, body) values ('bug', repeat(' ', 5) || 'short' || repeat(' ', 50))$$, '23514', null, 'blanks do not count towards the 10');
select lives_ok($$insert into public.feedback (kind, body) values ('bug', repeat('é', 2000))$$, '2000 characters are fine, counted as characters');
select throws_ok($$insert into public.feedback (kind, body) values ('bug', repeat('a', 2001))$$, '23514', null, '2001 are not');
select throws_ok($$insert into public.feedback (kind, body) values ('complaint', 'A kind that does not exist.')$$, '23514', null, 'an unknown kind is refused');
select throws_ok($$insert into public.feedback (kind, body) values (null, 'No kind at all, ten characters.')$$, '23502', null, 'and no kind');
select throws_ok($$insert into public.feedback (kind, body, context) values ('bug', 'A context that is not an object.', '[1,2]')$$, '23514', null, 'a context that is not an object is refused');
select throws_ok(
  $$insert into public.feedback (kind, body, context) values ('bug', 'A context that is far too large.', jsonb_build_object('x', repeat('a', 4001)))$$,
  '23514', null, 'a context over 4000 bytes is refused');
select lives_ok(
  $$insert into public.feedback (kind, body, context) values ('bug', 'A context just under the limit.', jsonb_build_object('x', repeat('a', 3980)))$$,
  'one under it is stored');
reset role;

-- ------------------------------------------------------------ the rate limit

select tests.act_as(:'cy');
select lives_ok($$insert into public.feedback (kind, body) select 'bug', 'Rate limit message number ' || g from generate_series(1, 5) g$$, 'Cy sends five in an hour');
select throws_ok($$insert into public.feedback (kind, body) values ('bug', 'Rate limit message number 6')$$, 'PT429', 'rate_limited', 'the sixth is refused with rate_limited (PT429)');
reset role;
select is(tests.rows_of(:'cy'), 5::bigint, 'and was not stored');

-- Older than an hour: the hourly count starts again, the daily one (20) still counts.
update public.feedback set created_at = now() - interval '2 hours' where member_id = :'cy'::uuid;
select tests.act_as(:'cy');
select lives_ok($$insert into public.feedback (kind, body) values ('bug', 'Two hours later, this goes through.')$$, 'an hour later the hourly limit has let go');
reset role;
update public.feedback set created_at = now() - interval '2 hours' where member_id = :'cy'::uuid;
insert into public.feedback (member_id, kind, body, created_at)
select :'cy'::uuid, 'bug', 'Filler for the daily limit ' || g, now() - interval '3 hours' from generate_series(1, 14) g;
select tests.act_as(:'cy');
select throws_ok($$insert into public.feedback (kind, body) values ('bug', 'Twenty-first message today.')$$, 'PT429', 'rate_limited', 'twenty in a day are the limit');
reset role;
select tests.act_as(:'ada');
select lives_ok($$insert into public.feedback (kind, body) values ('bug', 'Ada is not held back by Cy.')$$, 'and it counts per member');
reset role;
-- ---------------------------------------------------------------- not the owner

select tests.name_owner(null);
select tests.act_as(:'ada');
select throws_ok($$select * from public.feedback_list()$$, '42501', 'not_owner', 'while nobody is named, no member reads the inbox');
reset role;

select tests.name_owner(:'di');
select tests.act_as(:'ada');
select throws_ok($$select * from public.feedback_list()$$, '42501', 'not_owner', 'a member who is not the owner is refused');
select throws_ok($$select public.feedback_mark_handled(gen_random_uuid())$$, '42501', 'not_owner', 'and cannot mark a message');
reset role;

-- ------------------------------------------------------------------- the owner

-- Distinct times for Ada's four messages (one transaction gives every insert the same now()).
update public.feedback set created_at = now() - interval '4 minutes' where body = 'The sheet will not close on my phone.';
update public.feedback set created_at = now() - interval '3 minutes' where body = 'Please add a way to export my shelf.';
update public.feedback set created_at = now() - interval '2 minutes' where body = '<script>alert(1)</script> and a "quote" and a ''tick''';
update public.feedback set created_at = now() - interval '1 minute' where body = 'Ada is not held back by Cy.';

select tests.act_as(:'di');

select is((select count(*)::int from public.feedback_list(100) where member_email like '%@feedback.pgtap.test'), 26,
          'the owner reads the inbox: every message of this test');
select is((select array_agg(body order by created_at desc) from public.feedback_list(100) where member_email = 'ada@feedback.pgtap.test'),
          array['Ada is not held back by Cy.', '<script>alert(1)</script> and a "quote" and a ''tick''',
                'Please add a way to export my shelf.', 'The sheet will not close on my phone.'],
          'newest first, the text as it was written (markup and all, as plain text)');
select is((select member_name from public.feedback_list(100) where body = 'Ada is not held back by Cy.'), 'Ada', 'with the first name of who wrote it');
select is((select member_email from public.feedback_list(100) where body = 'Ada is not held back by Cy.'), 'ada@feedback.pgtap.test', 'and the address');
select is((select member_name from public.feedback_list(100) where member_email = 'bo@feedback.pgtap.test' limit 1), null, 'no name when she gave none');
select is((select context from public.feedback_list(100) where body = 'The sheet will not close on my phone.'),
          '{"route":"/profile","appVersion":"abc"}'::jsonb, 'the context comes with it');
select ok(pg_get_function_result('public.feedback_list(integer, timestamptz)'::regprocedure) !~ 'member_id|owner_note',
          'the inbox carries no member id and no note');

select is((select count(*)::int from public.feedback_list(2)), 2, 'a page is as long as asked');
select is((select count(*)::int from public.feedback_list(1000)), least(tests.all_rows(), 100), 'at most 100 whatever is asked');
select is((select count(*)::int from public.feedback_list(0)), 1, 'and at least one');
select is((select count(*)::int from public.feedback_list(null)), least(tests.all_rows(), 30), 'thirty by default');
select is((select count(*)::int from public.feedback_list(100, now() - interval '150 seconds')
            where member_email = 'ada@feedback.pgtap.test'), 2,
          'p_before pages back: only what is older than the given time');
select is((select count(*)::int from public.feedback_list(100, now() - interval '1 year')), 0, 'before a year ago: none');

-- Mark handled.
select is(public.feedback_mark_handled((select id from public.feedback_list(100) where body = 'Please add a way to export my shelf.')), true,
          'the owner marks a message handled');
select ok((select handled_at is not null from public.feedback_list(100) where body = 'Please add a way to export my shelf.'), 'it says when');
select is(public.feedback_mark_handled((select id from public.feedback_list(100) where body = 'Please add a way to export my shelf.'), false), true,
          'marking it open again');
select ok((select handled_at is null from public.feedback_list(100) where body = 'Please add a way to export my shelf.'), 'puts it back');
select is(public.feedback_mark_handled(gen_random_uuid()), false, 'an id that is nothing finds none');
reset role;

-- --------------------------------------------------------- the account going

select tests.act_as(:'ada');
select lives_ok($$select public.delete_my_account()$$, 'Ada deletes her account');
reset role;
select is(tests.rows_of(:'ada'), 0::bigint, 'her messages go with it');
select is(tests.rows_of(:'bo'), 2::bigint, 'Bo''s stay');

select * from finish();
rollback;
