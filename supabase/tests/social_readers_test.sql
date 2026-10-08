-- Social v1, D4: what a member reads of others (docs/proposals/social-v1-contract.md §1.5 "D4"):
--   supabase test db
--
-- The feed holds the members she follows and nobody else; a block, a hidden Book, a section
-- switched off or a row still inside its settle window keep a row out; ratings and reviews go
-- only where switched on; an abandon reason and the address never. A member's profile is null
-- to a stranger, a card to a member who opened a private account's link, whole to a follower
-- (or to anyone, for a public account). Her reading record has the shape data/stats.ts reads.
-- Photos open to connected members through a policy. Assertions ask about rows this test made.

begin;
select plan(45);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-SOCIAL-4', 'social readers test', 10);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-SOCIAL-4', 'name', p_name)), now(), now(), now());
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

create or replace function tests.snap(p_title text)
returns jsonb language sql as $$
  select jsonb_build_object('title', p_title, 'authors', jsonb_build_array('An Author'), 'source', 'apple',
                            'apple_id', (9800000000 + floor(random() * 99999999))::bigint::text)
$$;

-- A list (of feed entries, or a profile's rows) holds this Book, of this kind if given.
create or replace function tests.has_book(p_list jsonb, p_title text, p_kind text default null)
returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(coalesce(p_list, '[]')) e
                  where e -> 'book' ->> 'title' = p_title and (p_kind is null or e ->> 'kind' = p_kind))
$$;
create or replace function tests.entry_of(p_list jsonb, p_title text, p_kind text)
returns jsonb language sql as $$
  select e from jsonb_array_elements(coalesce(p_list, '[]')) e
   where e -> 'book' ->> 'title' = p_title and e ->> 'kind' = p_kind limit 1
$$;
create or replace function tests.has_read(p_record jsonb, p_title text, p_outcome text)
returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(coalesce(p_record -> 'reads', '[]')) r
                  where r -> 'entry' -> 'book' ->> 'title' = p_title and r ->> 'outcome' = p_outcome)
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, anon;
create temporary table pages (name text primary key, page jsonb) on commit drop;
grant all on pages to authenticated, anon;

insert into ids values
  ('ada', tests.member('ada@social4.pgtap.test', 'Ada')),
  ('ben', tests.member('ben@social4.pgtap.test', 'Ben')),
  ('cy',  tests.member('cy@social4.pgtap.test', 'Cy')),
  ('dan', tests.member('dan@social4.pgtap.test', 'Dan')),
  ('eve', tests.member('eve@social4.pgtap.test', 'Eve')),
  ('pia', tests.member('pia@social4.pgtap.test', 'Pia'));

update private.social_config set settle_window = interval '0';

-- Ada reads (private, by default): one of each kind.
select tests.act_as((select id from ids where name = 'ada'));
insert into ids values ('wish', (public.add_to_library(tests.snap('Kindred'), 'want_to_read')).id);
insert into ids values ('now', (public.add_to_library(tests.snap('Piranesi'), 'reading', current_date - 3)).id);
insert into ids values ('done', (public.add_to_library(tests.snap('The Left Hand of Darkness'), 'reading', current_date - 9)).id);
select public.finish_reading((select id from ids where name = 'done'), current_date, 18, 'Cold and warm.');
insert into ids values ('dnf', (public.add_to_library(tests.snap('Infinite Jest'), 'reading', current_date - 6)).id);
select public.abandon_reading((select id from ids where name = 'dnf'), current_date, 'too slow for now');

-- Pia is public and reads too.
select tests.act_as((select id from ids where name = 'pia'));
select public.set_private(false);
insert into ids values ('pia_done', (public.add_to_library(tests.snap('Circe'), 'reading', current_date - 4)).id);
select public.finish_reading((select id from ids where name = 'pia_done'), current_date, 16, null);

-- Ben and Dan follow Ada; Eve opened her link; Ada blocked Dan.
reset role;
insert into public.follows (follower_id, followee_id, accepted_at) values
  ((select id from ids where name = 'ben'), (select id from ids where name = 'ada'), now()),
  ((select id from ids where name = 'dan'), (select id from ids where name = 'ada'), now());
insert into public.follow_link_views (visitor_id, member_id) values
  ((select id from ids where name = 'eve'), (select id from ids where name = 'ada'));
insert into public.blocks (blocker_id, blocked_id) values
  ((select id from ids where name = 'ada'), (select id from ids where name = 'dan'));

-- --------------------------------------------------------------------- the feed

select tests.act_as((select id from ids where name = 'ben'));
select ok(tests.has_book(public.feed(), 'The Left Hand of Darkness', 'finished'), 'a follower sees her finish');
select is(tests.entry_of(public.feed(), 'The Left Hand of Darkness', 'finished') -> 'rating', '18'::jsonb, 'with her rating');
select is(tests.entry_of(public.feed(), 'The Left Hand of Darkness', 'finished') ->> 'review', 'Cold and warm.', 'and her review');
select is(tests.entry_of(public.feed(), 'The Left Hand of Darkness', 'finished') -> 'member' ->> 'name', 'Ada', 'and her first name');
select ok(tests.has_book(public.feed(), 'Piranesi', 'started'), 'what she started');
select ok(tests.has_book(public.feed(), 'Kindred', 'want'), 'what she wants to read');
select ok(tests.has_book(public.feed(), 'Infinite Jest', 'abandoned'), 'what she put down');
select ok(position('too slow' in public.feed()::text) = 0, 'never why she put it down');
select ok(position('social4.pgtap.test' in public.feed()::text) = 0, 'never her address');
select ok(not tests.has_book(public.feed(), 'Circe'), 'nothing of a member he does not follow');

insert into pages values ('first', public.feed(null, null, 1));
select is(jsonb_array_length((select page from pages where name = 'first')), 1, 'a page of one');
select isnt(
  public.feed(((select page from pages where name = 'first') -> 0 ->> 'at')::timestamptz,
              ((select page from pages where name = 'first') -> 0 ->> 'id')::uuid, 1) -> 0 ->> 'id',
  (select page from pages where name = 'first') -> 0 ->> 'id',
  'the next page starts after it');

select tests.act_as((select id from ids where name = 'cy'));
select is(public.feed(), '[]'::jsonb, 'a member who follows nobody has an empty feed');
select tests.act_as((select id from ids where name = 'eve'));
select ok(not tests.has_book(public.feed(), 'The Left Hand of Darkness'), 'opening her link is not following her');
select tests.act_as((select id from ids where name = 'dan'));
select ok(not tests.has_book(public.feed(), 'The Left Hand of Darkness'), 'a blocked follower sees nothing of her');

-- ------------------------------------------------------------- her switches

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"reviews": false, "ratings": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is(tests.entry_of(public.feed(), 'The Left Hand of Darkness', 'finished') -> 'review', 'null'::jsonb, 'reviews off: no review');
select is(tests.entry_of(public.feed(), 'The Left Hand of Darkness', 'finished') -> 'rating', 'null'::jsonb, 'ratings off: no rating');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"abandoned": false, "reading": false, "want": false}');
select tests.act_as((select id from ids where name = 'ben'));
select ok(not tests.has_book(public.feed(), 'Infinite Jest'), 'Did not finish off: no abandoned row');
select ok(not tests.has_book(public.feed(), 'Piranesi'), 'Currently reading off: no started row');
select ok(not tests.has_book(public.feed(), 'Kindred'), 'Want to read off: no want row');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"reviews": true, "ratings": true, "abandoned": true, "reading": true, "want": true}');
select public.set_entry_hidden((select id from ids where name = 'done'), true);
select tests.act_as((select id from ids where name = 'ben'));
select ok(not tests.has_book(public.feed(), 'The Left Hand of Darkness'), 'a hidden Book leaves the feed');
select ok(not tests.has_book(public.member_profile((select id from ids where name = 'ada')) -> 'finished', 'The Left Hand of Darkness'),
  'and her profile');
select ok(not tests.has_read(public.member_reading_record((select id from ids where name = 'ada')), 'The Left Hand of Darkness', 'finished'),
  'and her figures');
select tests.act_as((select id from ids where name = 'ada'));
select public.set_entry_hidden((select id from ids where name = 'done'), false);

-- ------------------------------------------------------------- the settle window

reset role;
update private.social_config set settle_window = interval '10 minutes';
select tests.act_as((select id from ids where name = 'ada'));
select public.add_to_library(tests.snap('Fresh Off The Press'), 'want_to_read');
select tests.act_as((select id from ids where name = 'ben'));
select ok(not tests.has_book(public.feed(), 'Fresh Off The Press'), 'a row inside its settle window is not shown yet');
reset role;
update private.social_config set settle_window = interval '0';

-- ------------------------------------------------------------------ her profile

select tests.act_as((select id from ids where name = 'ben'));
insert into pages values ('ada_for_ben', public.member_profile((select id from ids where name = 'ada')));
select is((select page from pages where name = 'ada_for_ben') -> 'visible', 'true'::jsonb, 'a follower sees her profile');
select is((select page from pages where name = 'ada_for_ben') ->> 'state', 'following', 'as her follower');
select ok(tests.has_book((select page from pages where name = 'ada_for_ben') -> 'finished', 'The Left Hand of Darkness'), 'with what she finished');
select ok(tests.has_book((select page from pages where name = 'ada_for_ben') -> 'reading', 'Piranesi'), 'what she is reading');
select ok(tests.has_book((select page from pages where name = 'ada_for_ben') -> 'want', 'Kindred'), 'and what she wants to read');
select is((select page from pages where name = 'ada_for_ben') -> 'counts' -> 'read', '1'::jsonb, 'her count of Books read');
select ok(position('too slow' in (select page from pages where name = 'ada_for_ben')::text) = 0
          and position('social4.pgtap.test' in (select page from pages where name = 'ada_for_ben')::text) = 0,
  'never an abandon reason or her address');
select is(public.member_profile((select id from ids where name = 'ben')), null::jsonb, 'his own profile is not asked here');

select tests.act_as((select id from ids where name = 'eve'));
insert into pages values ('ada_for_eve', public.member_profile((select id from ids where name = 'ada')));
select is((select page from pages where name = 'ada_for_eve') -> 'visible', 'false'::jsonb, 'her link shows a private card');
select ok(not ((select page from pages where name = 'ada_for_eve') ? 'finished'), 'and none of her reading');

select tests.act_as((select id from ids where name = 'cy'));
select is(public.member_profile((select id from ids where name = 'ada')), null::jsonb, 'a stranger finds no profile');
select is(public.member_profile((select id from ids where name = 'pia')) -> 'visible', 'true'::jsonb, 'but a public member''s whole');
select tests.act_as((select id from ids where name = 'dan'));
select is(public.member_profile((select id from ids where name = 'ada')), null::jsonb, 'a blocked member finds no profile');

-- ------------------------------------------------------------ her reading record

select tests.act_as((select id from ids where name = 'ben'));
select ok(tests.has_read(public.member_reading_record((select id from ids where name = 'ada')), 'The Left Hand of Darkness', 'finished'),
  'a follower gets her closed reads');
select ok((public.member_reading_record((select id from ids where name = 'ada')) -> 'reads' -> 0) ?& array['id', 'entry_id', 'started_on', 'ended_on', 'outcome', 'rating', 'created_at', 'entry'],
  'in the shape data/stats.ts reads');
select ok(tests.has_read(public.member_reading_record((select id from ids where name = 'ada')), 'Infinite Jest', 'abandoned'),
  'with what she put down while that is on');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"abandoned": false}');
select tests.act_as((select id from ids where name = 'ben'));
select ok(not tests.has_read(public.member_reading_record((select id from ids where name = 'ada')), 'Infinite Jest', 'abandoned'),
  'and without it while it is off');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"year": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is(public.member_reading_record((select id from ids where name = 'ada')), null::jsonb, 'with figures off there is no record');
select tests.act_as((select id from ids where name = 'eve'));
select is(public.member_reading_record((select id from ids where name = 'pia')) -> 'reads' -> 0 -> 'entry' -> 'book' ->> 'title', 'Circe',
  'a public member''s record is anyone''s');

-- --------------------------------------------------------------------- photos

select ok(exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars_select_connected'),
  'photos open to connected members through their own policy');

select tests.act_anon();
select throws_ok($$ select public.feed() $$, '42501', null, 'signed out, there is no feed');

select * from finish();
rollback;
