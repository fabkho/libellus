-- A checked Catalogue (social v2a contract §5):
--   supabase test db
--
-- A Book a member adds starts unchecked, whatever she sends; a Manual book is never queued or
-- checked. Until the check has read a Book at its source, other members (her record) and the public
-- reading page get its title and authors but not its description; her own Library shows her row as
-- she added it. The claim picks only unchecked Catalogue Books, once at a time, and a Book whose
-- source is down comes back later; a save writes what the source said (validated) and opens the
-- description; a miss marks the Book failed and clears its description. Only the service role calls the
-- check's functions.

begin;
select plan(37);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-CHECK-1', 'catalogue check test', 10);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-CHECK-1', 'name', p_name)), now(), now(), now());
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
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end;
$$;

-- A snapshot the way a client sends one: a blurb of her own, and a cover on a host that is not a source's.
create or replace function tests.snap(p_title text)
returns jsonb language sql as $$
  select jsonb_build_object('title', p_title, 'authors', jsonb_build_array('An Author'), 'source', 'apple',
                            'apple_id', (9800000000 + floor(random() * 99999999))::bigint::text,
                            'description', 'Blurb of ' || p_title,
                            'cover_url', 'https://example.org/' || md5(p_title) || '.jpg',
                            'cover_thumbhash', 'abc', 'cover_dominant', '#112233', 'cover_secondary', '#445566')
$$;

create or replace function tests.book_of(p_entry uuid)
returns uuid language sql security definer as $$ select book_id from public.library_entries where id = p_entry $$;

-- The record's Book, as another member reads it.
create or replace function tests.record_book(p_member uuid, p_title text)
returns jsonb language sql security definer as $$
  select r -> 'entry' -> 'book'
    from jsonb_array_elements(public.member_reading_record(p_member) -> 'reads') r
   where r -> 'entry' -> 'book' ->> 'title' = p_title
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, anon;
create temporary table links (name text primary key, link text) on commit drop;
grant all on links to authenticated, anon;

-- Whatever else is in this database is checked already: the claims below see only this test's Books.
update public.books set checked_at = now() where owner_id is null and checked_at is null;
update private.social_config set settle_window = interval '0';

insert into ids values
  ('ada', tests.member('ada@check.pgtap.test', 'Ada')),
  ('ben', tests.member('ben@check.pgtap.test', 'Ben'));

-- ------------------------------------------------------------ Ada, public; Ben follows

select tests.act_as((select id from ids where name = 'ada'));
select public.set_private(false);
select tests.act_as((select id from ids where name = 'ben'));
select public.follow((select id from ids where name = 'ada'));

-- ------------------------------------------------- what a new Book starts as

select tests.act_as((select id from ids where name = 'ada'));
insert into ids values
  ('open',   (public.add_to_library(tests.snap('Open Book'), 'reading', current_date - 3)).id),
  ('saved',  (public.add_to_library(tests.snap('Saved Book'), 'reading', current_date - 3)).id),
  ('missed', (public.add_to_library(tests.snap('Missed Book'), 'reading', current_date - 3)).id),
  ('late',   (public.add_to_library(tests.snap('Late Book'), 'reading', current_date - 3)).id),
  ('claim',  (public.add_to_library(tests.snap('Claim Book'), 'reading', current_date - 3)).id);
-- A client that sends the check's columns does not get them: the insert names its columns.
insert into ids values
  ('sly', (public.add_to_library(tests.snap('Sly Book') || '{"checked_at":"2026-01-01T00:00:00Z","check_failed":true}', 'reading', current_date - 3)).id);
select public.finish_reading((select id from ids where name = 'open'), current_date, 18, null);
select public.finish_reading((select id from ids where name = 'saved'), current_date, 18, null);
select public.finish_reading((select id from ids where name = 'missed'), current_date, 18, null);
select public.finish_reading((select id from ids where name = 'late'), current_date, 18, null);
select public.finish_reading((select id from ids where name = 'sly'), current_date, 18, null);
insert into ids values ('notebook', (select book_id from public.add_manual_book('A Notebook', array['Ada'], null, null)));

reset role;
insert into ids select 'b_' || name, tests.book_of(id) from ids where name in ('open', 'saved', 'missed', 'late', 'claim', 'sly');
-- A client never stores a description for a Catalogue Book (books_no_client_description): the blurbs the
-- rest of this file reads are legacy ones, set here as they were before.
select is((select count(*)::int from public.books where id in (select id from ids where name like 'b\_%') and description is not null), 0,
  'a description a client sends for a Catalogue Book is not stored');
update public.books set description = 'Blurb of ' || title where id in (select id from ids where name like 'b\_%');

select is((select checked_at from public.books where id = (select id from ids where name = 'b_open')), null,
  'a Book a member adds starts unchecked');
select is((select check_failed from public.books where id = (select id from ids where name = 'b_open')), false,
  'and not failed');
select ok((select checked_at is null and not check_failed from public.books where id = (select id from ids where name = 'b_sly')),
  'whatever the client says about it');

-- --------------------------------------------- unchecked: description withheld

select tests.act_as((select id from ids where name = 'ben'));
select is(tests.record_book((select id from ids where name = 'ada'), 'Open Book') -> 'description', 'null'::jsonb,
  'an unchecked Book hands another member no description');
select is(tests.record_book((select id from ids where name = 'ada'), 'Open Book') ->> 'title', 'Open Book',
  'but its title');
select is(tests.record_book((select id from ids where name = 'ada'), 'Open Book') -> 'authors', '["An Author"]'::jsonb,
  'and its authors');
select is(tests.record_book((select id from ids where name = 'ada'), 'Open Book') -> 'cover_url', 'null'::jsonb,
  'and its cover only by the allowlist (this host is not on it)');

select tests.act_as((select id from ids where name = 'ada'));
select is((select description from public.books where id = (select id from ids where name = 'b_open')), 'Blurb of Open Book',
  'her own Library reads the row as she added it');

reset role;
select ok(not private.social_book_json((select b from public.books b where b.id = (select id from ids where name = 'b_open'))) ? 'description',
  'the social json of a Book carries no description at all');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_reading_page(true);
insert into links values ('page', (select token from public.reading_pages where member_id = (select id from ids where name = 'ada')));
select tests.act_anon();
select ok(position('Open Book' in public.public_reading_page((select link from links where name = 'page'))::text) > 0,
  'the public reading page shows an unchecked Book''s title');
select ok(position('Blurb of Open Book' in public.public_reading_page((select link from links where name = 'page'))::text) = 0,
  'but not its description');

-- ------------------------------------------------------ Manual books, never

reset role;
create temporary table claimed as select * from public.catalogue_check_claim(50);
select is((select count(*)::int from claimed where owner_id is not null), 0, 'a Manual book is never claimed');
select throws_ok(
  format($f$update public.books set checked_at = now() where id = %L$f$, (select id from ids where name = 'notebook')),
  '23514', null, 'nor can it be marked checked');
select is((select checked_at from public.books where id = (select id from ids where name = 'notebook')), null,
  'a Manual book stays unchecked');
select is(public.catalogue_check_save((select id from ids where name = 'notebook'), '{"title":"Hijacked"}'), false,
  'a save for a Manual book writes nothing');
select is((select title from public.books where id = (select id from ids where name = 'notebook')), 'A Notebook',
  'and the title is still hers');

-- ---------------------------------------------------------- the dispatch

select is((select array_agg(title order by title) from claimed),
  array['Claim Book', 'Late Book', 'Missed Book', 'Open Book', 'Saved Book', 'Sly Book'],
  'the claim picks the unchecked Catalogue Books, all six of them');
select is((select count(*)::int from public.catalogue_check_claim(50)), 0,
  'and only once: they are leased');

-- Save one, miss one, fail one, release one.
select is(public.catalogue_check_save((select id from ids where name = 'b_saved'), jsonb_build_object(
  'title', 'Saved Book (checked)', 'authors', jsonb_build_array('Real Author', 'Second Author'),
  'description', 'What the source says.', 'cover_url', 'https://is1-ssl.mzstatic.com/image/thumb/x/600x900bb.jpg')), true,
  'a save answers true');
select is(public.catalogue_check_miss((select id from ids where name = 'b_missed')), true, 'a miss answers true');
select public.catalogue_check_failed((select id from ids where name = 'b_late'), 'itunes: 503');
select public.catalogue_check_release((select id from ids where name = 'b_claim'));
update private.catalogue_check_state set claimed_until = now() - interval '1 second' where book_id = (select id from ids where name = 'b_open');

select is((select array_agg(title order by title) from public.catalogue_check_claim(50) where owner_id is null),
  array['Claim Book', 'Open Book'],
  'the next claim picks only what is unchecked, not leased, not backing off (the released and the lapsed lease; not the saved, the missed, the late, the still leased)');
select ok((select not_before > now() + interval '4 minutes' from private.catalogue_check_state where book_id = (select id from ids where name = 'b_late')),
  'a Book whose source was down waits at least five minutes');

-- ------------------------------------------------------------- a save

select is((select (title, authors, description, checked_at is not null, check_failed)::text from public.books where id = (select id from ids where name = 'b_saved')),
  '("Saved Book (checked)","{""Real Author"",""Second Author""}","What the source says.",t,f)',
  'a save writes the title, authors and description the source gave, and marks the Book checked');
select is((select (cover_url, cover_thumbhash, cover_dominant)::text from public.books where id = (select id from ids where name = 'b_saved')),
  '(https://is1-ssl.mzstatic.com/image/thumb/x/600x900bb.jpg,,)',
  'a new cover drops the thumbhash and colours of the old one');

select tests.act_as((select id from ids where name = 'ben'));
select is(tests.record_book((select id from ids where name = 'ada'), 'Saved Book (checked)') ->> 'description', 'What the source says.',
  'now another member gets the description, the source''s');
select is(tests.record_book((select id from ids where name = 'ada'), 'Saved Book (checked)') ->> 'cover_url',
  'https://is1-ssl.mzstatic.com/image/thumb/x/600x900bb.jpg', 'and the source''s cover');

reset role;
select is(public.catalogue_check_save((select id from ids where name = 'b_saved'), '{"title":"Again"}'), false,
  'a checked Book is not written again');

-- Validation: what is not a source's authors, cover or short blurb is not stored; a Book without the
-- source's title cannot be verified.
select throws_ok(
  format($f$select public.catalogue_check_save(%L, jsonb_build_object('title', repeat('x', 501)))$f$, (select id from ids where name = 'b_open')),
  '22023', 'result_invalid', 'a title that is too long is no verification');
select public.catalogue_check_save((select id from ids where name = 'b_open'), jsonb_build_object(
  'title', 'Open Book', 'authors', jsonb_build_array('Fine', 5), 'description', null,
  'cover_url', 'https://evil.example/cover.jpg'));
select is((select (title, authors, description, cover_url, checked_at is not null)::text from public.books where id = (select id from ids where name = 'b_open')),
  '("Open Book",{},,,t)',
  'authors not all text and a cover off the sources'' hosts are not kept, and the source''s empty description clears the first member''s: a verified Book is the source''s alone');

select throws_ok($q$select public.catalogue_check_save(gen_random_uuid(), '[]')$q$, '22023', 'result_invalid',
  'a result that is not an object is refused');

-- ------------------------------------------------------------- a miss

select is((select (title, description, cover_url, checked_at is not null, check_failed, check_unknown)::text from public.books where id = (select id from ids where name = 'b_missed')),
  '("Missed Book",,https://example.org/' || md5('Missed Book') || '.jpg,t,f,t)',
  'a Book its source does not know is checked and unknown, not failed, and its legacy description is cleared');
select tests.act_as((select id from ids where name = 'ben'));
select is(tests.record_book((select id from ids where name = 'ada'), 'Missed Book') ->> 'title', 'Missed Book',
  'others still get its title (as for a Manual book: catalogue_check_unknown_test.sql has the rest)');
select is(tests.record_book((select id from ids where name = 'ada'), 'Missed Book') -> 'description', 'null'::jsonb, 'but no description');

-- ------------------------------------------------------ who may call, the kick

reset role;
select tests.act_as((select id from ids where name = 'ada'));
select throws_ok($q$select * from public.catalogue_check_claim(1)$q$, '42501', null, 'a member cannot claim');
select throws_ok($q$select public.catalogue_check_save(gen_random_uuid(), '{}')$q$, '42501', null, 'nor save');
reset role;
select is(private.catalogue_check_kick(), 'off', 'the kick sends nothing where no function address is configured');

select * from finish();
rollback;
