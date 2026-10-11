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
select plan(144);

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

-- Gate 2: the cover of a titled Book in a list of {book: …}, the closed read of a title in a
-- record, and whether the feed's started row of a title says "again".
create or replace function tests.cover_of(p_list jsonb, p_title text)
returns text language sql as $$
  select e -> 'book' ->> 'cover_url' from jsonb_array_elements(coalesce(p_list, '[]')) e
   where e -> 'book' ->> 'title' = p_title limit 1
$$;
create or replace function tests.read_of(p_record jsonb, p_title text, p_outcome text)
returns jsonb language sql as $$
  select r from jsonb_array_elements(coalesce(p_record -> 'reads', '[]')) r
   where r -> 'entry' -> 'book' ->> 'title' = p_title and r ->> 'outcome' = p_outcome limit 1
$$;
create or replace function tests.is_again(p_feed jsonb, p_title text)
returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(coalesce(p_feed, '[]')) e
                  where e -> 'book' ->> 'title' = p_title and e ->> 'kind' = 'started' and e ->> 'again' = 'true')
$$;
-- Her Book of her own making, with a cover she typed (set past the API, as the table allows it).
create or replace function tests.manual_with_cover(p_title text, p_cover text, p_status text default 'want_to_read')
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_entry uuid;
begin
  v_entry := (public.add_manual_book(p_title, array['Some Author'], null, 100, 'want_to_read')).id;
  if p_status = 'finished' then
    perform public.start_reading(v_entry, current_date - 3);
    perform public.finish_reading(v_entry, current_date, 16, null);
  end if;
  update public.books set cover_url = p_cover, cover_thumbhash = 'thumb', cover_dominant = '#aabbcc', cover_secondary = '#112233'
   where id = (select book_id from public.library_entries where id = v_entry);
  return v_entry;
end;
$$;

-- S1: the same for a Catalogue Book (no owner): its cover is whatever the first member to add it sent,
-- so it is set past the API here, as `catalogue_book_for` lets it be stored.
create or replace function tests.catalogue_with_cover(p_title text, p_cover text, p_status text default 'want_to_read')
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_entry uuid;
begin
  v_entry := (public.add_to_library(tests.snap(p_title), 'want_to_read')).id;
  if p_status = 'finished' then
    perform public.start_reading(v_entry, current_date - 3);
    perform public.finish_reading(v_entry, current_date, 16, null);
  end if;
  update public.books set cover_url = p_cover, cover_thumbhash = 'thumb', cover_dominant = '#aabbcc', cover_secondary = '#112233'
   where id = (select book_id from public.library_entries where id = v_entry) and owner_id is null;
  return v_entry;
end;
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, anon;
create temporary table pages (name text primary key, page jsonb) on commit drop;
grant all on pages to authenticated, anon;
create temporary table links (name text primary key, link text) on commit drop;
grant all on links to authenticated, anon;

insert into ids values
  ('ada', tests.member('ada@social4.pgtap.test', 'Ada')),
  ('ben', tests.member('ben@social4.pgtap.test', 'Ben')),
  ('cy',  tests.member('cy@social4.pgtap.test', 'Cy')),
  ('dan', tests.member('dan@social4.pgtap.test', 'Dan')),
  ('eve', tests.member('eve@social4.pgtap.test', 'Eve')),
  ('pia', tests.member('pia@social4.pgtap.test', 'Pia')),
  ('gil', tests.member('gil@social4.pgtap.test', 'Gil'));

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

-- Ben and Dan follow Ada; Gil asked and waits; Eve opened her link; Ada blocked Dan.
reset role;
insert into public.follows (follower_id, followee_id, accepted_at) values
  ((select id from ids where name = 'ben'), (select id from ids where name = 'ada'), now()),
  ((select id from ids where name = 'dan'), (select id from ids where name = 'ada'), now()),
  ((select id from ids where name = 'gil'), (select id from ids where name = 'ada'), null);
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
select tests.act_as((select id from ids where name = 'gil'));
select ok(not tests.has_book(public.feed(), 'The Left Hand of Darkness'), 'a request still waiting sees nothing of her');

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
select ok(tests.has_book(public.member_want((select id from ids where name = 'ada')), 'Kindred'), 'See all: her whole Want to read');

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
select ok(position('too slow' in public.member_reading_record((select id from ids where name = 'ada'))::text) = 0,
  'but never why');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"abandoned": false}');
select tests.act_as((select id from ids where name = 'ben'));
select ok(not tests.has_read(public.member_reading_record((select id from ids where name = 'ada')), 'Infinite Jest', 'abandoned'),
  'and without it while it is off');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"finished": false}');
select tests.act_as((select id from ids where name = 'ben'));
select ok(not tests.has_read(public.member_reading_record((select id from ids where name = 'ada')), 'The Left Hand of Darkness', 'finished'),
  'Finished off: her figures leave out what she finished');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"year": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is(public.member_reading_record((select id from ids where name = 'ada')), null::jsonb, 'with figures off there is no record');
select tests.act_as((select id from ids where name = 'eve'));
select is(public.member_reading_record((select id from ids where name = 'pia')) -> 'reads' -> 0 -> 'entry' -> 'book' ->> 'title', 'Circe',
  'a public member''s record is anyone''s');

-- ==================================================================== gate 2 (privacy review)

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"reading": true, "want": true, "finished": true, "ratings": true, "reviews": true, "abandoned": true, "year": true}');

-- ------------------------------------------------------------ her whole Want to read

select tests.act_as((select id from ids where name = 'cy'));
select is(public.member_want((select id from ids where name = 'ada')), null::jsonb, 'a stranger finds no Want to read of a private member');
select tests.act_as((select id from ids where name = 'gil'));
select is(public.member_want((select id from ids where name = 'ada')), null::jsonb, 'a member whose request waits finds none');
select tests.act_as((select id from ids where name = 'dan'));
select is(public.member_want((select id from ids where name = 'ada')), null::jsonb, 'a blocked member finds none');
select tests.act_as((select id from ids where name = 'eve'));
select is(public.member_want((select id from ids where name = 'ada')), null::jsonb, 'one who only opened her link finds none');
select is(public.member_want((select id from ids where name = 'pia')), '[]'::jsonb, 'but a public member''s is anyone''s (here empty)');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"want": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is(public.member_want((select id from ids where name = 'ada')), null::jsonb, 'with Want to read off a follower finds none');
select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"want": true}');
select public.set_entry_hidden((select id from ids where name = 'wish'), true);
select tests.act_as((select id from ids where name = 'ben'));
select ok(not tests.has_book(public.member_want((select id from ids where name = 'ada')), 'Kindred'), 'a hidden Book is not in her Want to read');
select ok(not tests.has_book(public.member_profile((select id from ids where name = 'ada')) -> 'want', 'Kindred'), 'nor on her profile');
select tests.act_as((select id from ids where name = 'ada'));
select public.set_entry_hidden((select id from ids where name = 'wish'), false);
select tests.act_as((select id from ids where name = 'ben'));
select ok(tests.has_book(public.member_want((select id from ids where name = 'ada')), 'Kindred'), 'and is back once shown again');

-- ------------------------------------------------------ a profile, switch by switch

select is(jsonb_typeof(public.member_profile((select id from ids where name = 'ada')) -> 'counts' -> 'read'), 'number', 'all on: her count of Books read');
select is(jsonb_typeof(public.member_profile((select id from ids where name = 'ada')) -> 'counts' -> 'reading'), 'number', 'and of Books she is reading');
select is(jsonb_typeof(public.member_profile((select id from ids where name = 'ada')) -> 'counts' -> 'want'), 'number', 'and of Books she wants');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"finished": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is(public.member_profile((select id from ids where name = 'ada')) -> 'counts' -> 'read', 'null'::jsonb, 'Finished off: no count of Books read');
select is(public.member_profile((select id from ids where name = 'ada')) -> 'finished', '[]'::jsonb, 'and no finished Books');
select is(jsonb_typeof(public.member_profile((select id from ids where name = 'ada')) -> 'counts' -> 'reading'), 'number', 'the other counts stay');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"finished": true, "reading": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is(public.member_profile((select id from ids where name = 'ada')) -> 'counts' -> 'reading', 'null'::jsonb, 'Currently reading off: no count');
select is(public.member_profile((select id from ids where name = 'ada')) -> 'reading', '[]'::jsonb, 'and no Books she reads');
select is(jsonb_typeof(public.member_profile((select id from ids where name = 'ada')) -> 'counts' -> 'read'), 'number', 'Books read stay');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"reading": true, "want": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is(public.member_profile((select id from ids where name = 'ada')) -> 'counts' -> 'want', 'null'::jsonb, 'Want to read off: no count');
select is(public.member_profile((select id from ids where name = 'ada')) -> 'want', '[]'::jsonb, 'and no Books she wants');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"want": true, "ratings": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is(public.member_profile((select id from ids where name = 'ada')) -> 'finished' -> 0 -> 'rating', 'null'::jsonb, 'Ratings off: a finished Book has none');
select isnt(public.member_profile((select id from ids where name = 'ada')) -> 'finished' -> 0 -> 'review', 'null'::jsonb, 'but keeps its review');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"ratings": true, "reviews": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is(public.member_profile((select id from ids where name = 'ada')) -> 'finished' -> 0 -> 'review', 'null'::jsonb, 'Reviews off: a finished Book has none');
select isnt(public.member_profile((select id from ids where name = 'ada')) -> 'finished' -> 0 -> 'rating', 'null'::jsonb, 'but keeps its rating');
select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"reviews": true}');

select tests.act_as((select id from ids where name = 'ben'));
select is(public.member_profile((select id from ids where name = 'ada')) -> 'followsYou', 'false'::jsonb, 'she does not follow him');
select is(public.member_profile((select id from ids where name = 'pia')) -> 'followsYou', 'false'::jsonb, 'nor does a public member he follows');
reset role;
insert into public.follows (follower_id, followee_id, accepted_at)
  values ((select id from ids where name = 'ada'), (select id from ids where name = 'ben'), now());
select tests.act_as((select id from ids where name = 'ben'));
select is(public.member_profile((select id from ids where name = 'ada')) -> 'followsYou', 'true'::jsonb, 'once she follows him, followsYou says so');
reset role;
delete from public.follows
 where follower_id = (select id from ids where name = 'ada') and followee_id = (select id from ids where name = 'ben');

-- -------------------------------------------------- the feed: again, reviewed

select tests.act_as((select id from ids where name = 'ada'));
select public.read_again((select id from ids where name = 'done'), current_date);
insert into ids values ('later', (public.add_to_library(tests.snap('Review Later'), 'reading', current_date - 5)).id);
select public.finish_reading((select id from ids where name = 'later'), current_date, 16, null);
select public.update_session(
  (select id from public.reading_sessions where entry_id = (select id from ids where name = 'later')),
  current_date - 5, current_date, 16, 'Words, a day later.', null);

select tests.act_as((select id from ids where name = 'ben'));
select ok(tests.is_again(public.feed(), 'The Left Hand of Darkness'), 'reading a finished Book again says "again"');
select ok(tests.has_book(public.feed(), 'Review Later', 'reviewed'), 'a review added after the finish is a "reviewed" row');
select is(tests.entry_of(public.feed(), 'Review Later', 'reviewed') ->> 'review', 'Words, a day later.', 'with her words');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"finished": false}');
select tests.act_as((select id from ids where name = 'ben'));
select ok(not tests.is_again(public.feed(), 'The Left Hand of Darkness'), 'Finished off: no "again", it would tell what she finished');
select ok(tests.has_book(public.feed(), 'The Left Hand of Darkness', 'started'), 'though the started row stays');
select ok(not tests.has_book(public.feed(), 'Review Later', 'reviewed'), 'Finished off: no "reviewed" row either');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"finished": true, "reviews": false}');
select tests.act_as((select id from ids where name = 'ben'));
select ok(not tests.has_book(public.feed(), 'Review Later', 'reviewed'), 'Reviews off: no "reviewed" row');
select ok(tests.has_book(public.feed(), 'Review Later', 'finished'), 'but she still finished it');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"reviews": true}');
select tests.act_as((select id from ids where name = 'ben'));
select ok(tests.has_book(public.feed(), 'Review Later', 'reviewed'), 'both on: the "reviewed" row is back');

-- Gate 2, fix 4: a review she has since cleared leaves no "reviewed X" without words.
reset role;
update public.reading_sessions set review = null
 where entry_id = (select id from ids where name = 'later') and outcome = 'finished';
select tests.act_as((select id from ids where name = 'ben'));
select ok(not tests.has_book(public.feed(), 'Review Later', 'reviewed'), 'a review she cleared leaves no "reviewed" row');
select ok(tests.has_book(public.feed(), 'Review Later', 'finished'), 'and her finish stays');

-- ------------------------------------------------ her reading record, in gate 2

select ok(tests.read_of(public.member_reading_record((select id from ids where name = 'ada')), 'The Left Hand of Darkness', 'finished') -> 'rating' <> 'null'::jsonb,
  'a follower gets her rating while ratings are on');
select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"ratings": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is(tests.read_of(public.member_reading_record((select id from ids where name = 'ada')), 'The Left Hand of Darkness', 'finished') -> 'rating', 'null'::jsonb,
  'Ratings off: the closed read has none');
select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"ratings": true}');
select public.set_entry_hidden((select id from ids where name = 'later'), true);
select tests.act_as((select id from ids where name = 'ben'));
select ok(not tests.has_read(public.member_reading_record((select id from ids where name = 'ada')), 'Review Later', 'finished'), 'a hidden Book is not in her record');
select tests.act_as((select id from ids where name = 'ada'));
select public.set_entry_hidden((select id from ids where name = 'later'), false);
select tests.act_as((select id from ids where name = 'ben'));
select ok(tests.has_read(public.member_reading_record((select id from ids where name = 'ada')), 'Review Later', 'finished'), 'and is back once shown again');

select tests.act_as((select id from ids where name = 'gil'));
select is(public.member_reading_record((select id from ids where name = 'ada')), null::jsonb, 'a member whose request waits gets no record');
select tests.act_as((select id from ids where name = 'dan'));
select is(public.member_reading_record((select id from ids where name = 'ada')), null::jsonb, 'a blocked member gets none');
select tests.act_as((select id from ids where name = 'cy'));
select is(public.member_reading_record((select id from ids where name = 'ada')), null::jsonb, 'a stranger gets none');

-- ------------------------------------- gate 2, fix 1: a cover she typed is no tracking pixel

select tests.act_as((select id from ids where name = 'ada'));
select tests.manual_with_cover('Pixel Book', 'https://tracker.example/pixel.png?u=ada');
select tests.manual_with_cover('Userinfo Book', 'https://covers.openlibrary.org@tracker.example/b/id/1-L.jpg');
select tests.manual_with_cover('Suffix Book', 'https://covers.openlibrary.org.tracker.example/b/id/1-L.jpg');
select tests.manual_with_cover('Http Book', 'http://covers.openlibrary.org/b/id/1-L.jpg');
select tests.manual_with_cover('Open Library Book', 'https://covers.openlibrary.org/b/id/1-L.jpg');
select tests.manual_with_cover('Apple Book', 'https://is3-ssl.mzstatic.com/image/thumb/a/600x900bb.jpg');
select tests.manual_with_cover('Regal Book', 'https://books.fabkho.dev/covers/a.jpg');
select tests.manual_with_cover('Pixel Read', 'https://tracker.example/pixel-read.png', 'finished');
select tests.manual_with_cover('Good Read', 'https://covers.openlibrary.org/b/id/2-L.jpg', 'finished');
select public.set_reading_page(true);
insert into links values ('page', (select token from public.reading_pages where member_id = (select id from ids where name = 'ada')));

select tests.act_as((select id from ids where name = 'ben'));
select is(tests.cover_of(public.member_want((select id from ids where name = 'ada')), 'Pixel Book'), null, 'her Want to read: a cover on any host is not shown');
select is(tests.cover_of(public.member_want((select id from ids where name = 'ada')), 'Userinfo Book'), null, 'nor one whose host is only a name before an @');
select is(tests.cover_of(public.member_want((select id from ids where name = 'ada')), 'Suffix Book'), null, 'nor one on a host that only begins like a known one');
select is(tests.cover_of(public.member_want((select id from ids where name = 'ada')), 'Http Book'), null, 'nor a plain http one');
select is(tests.cover_of(public.member_want((select id from ids where name = 'ada')), 'Open Library Book'), 'https://covers.openlibrary.org/b/id/1-L.jpg', 'an Open Library cover stays');
select is(tests.cover_of(public.member_want((select id from ids where name = 'ada')), 'Apple Book'), 'https://is3-ssl.mzstatic.com/image/thumb/a/600x900bb.jpg', 'an Apple cover stays');
select is(tests.cover_of(public.member_want((select id from ids where name = 'ada')), 'Regal Book'), 'https://books.fabkho.dev/covers/a.jpg', 'and one of the Regal library');
select is(public.member_want((select id from ids where name = 'ada')) @> jsonb_build_array(jsonb_build_object('book', jsonb_build_object('title', 'Pixel Book', 'cover_thumbhash', null, 'cover_dominant', null, 'cover_secondary', null))),
  true, 'the thumbhash and colours go with a cover that is dropped');
select is(tests.cover_of(public.member_want((select id from ids where name = 'ada')), 'Kindred'), null, 'a catalogue Book without a cover is as it was');

select is(tests.cover_of(public.feed(null, null, 50), 'Pixel Book'), null, 'the feed: her typed cover is not shown');
select ok(tests.has_book(public.feed(null, null, 50), 'Pixel Book', 'want'), 'though the row is');
select is(tests.cover_of(public.feed(null, null, 50), 'Open Library Book'), 'https://covers.openlibrary.org/b/id/1-L.jpg', 'a known host is');
select is(tests.cover_of(public.member_profile((select id from ids where name = 'ada')) -> 'want', 'Pixel Book'), null, 'her profile: Want to read, not shown');
select is(tests.cover_of(public.member_profile((select id from ids where name = 'ada')) -> 'want', 'Open Library Book'), 'https://covers.openlibrary.org/b/id/1-L.jpg', 'a known host is');
select is(tests.cover_of(public.member_profile((select id from ids where name = 'ada')) -> 'finished', 'Pixel Read'), null, 'her profile: finished, not shown');
select is(tests.cover_of(public.member_profile((select id from ids where name = 'ada')) -> 'finished', 'Good Read'), 'https://covers.openlibrary.org/b/id/2-L.jpg', 'a known host is');
select is(tests.read_of(public.member_reading_record((select id from ids where name = 'ada')), 'Pixel Read', 'finished') -> 'entry' -> 'book' -> 'cover_url', 'null'::jsonb, 'her record: not shown');
select is(tests.read_of(public.member_reading_record((select id from ids where name = 'ada')), 'Pixel Read', 'finished') -> 'entry' -> 'book' -> 'cover_thumbhash', 'null'::jsonb, 'nor its thumbhash');
select is(tests.read_of(public.member_reading_record((select id from ids where name = 'ada')), 'Good Read', 'finished') -> 'entry' -> 'book' ->> 'cover_url', 'https://covers.openlibrary.org/b/id/2-L.jpg', 'a known host is');

select tests.act_anon();
select ok(position('tracker.example' in public.public_reading_page((select link from links where name = 'page'))::text) = 0, 'her public reading page: no typed cover');
select ok(position('covers.openlibrary.org/b/id/2-L.jpg' in public.public_reading_page((select link from links where name = 'page'))::text) > 0, 'but a known host stays');
reset role;

-- ------------------------------- S1: a Catalogue Book's cover is no exception to the host list

-- Since 20261022010000 the table refuses such a cover on a Catalogue Book, so this is a row from before
-- (the migration cleans them): the check is dropped for the rest of this transaction to set one up,
-- and cover_shown must still hide it.
alter table public.books drop constraint books_cover_url_allowed;

select tests.act_as((select id from ids where name = 'ada'));
select tests.catalogue_with_cover('Foreign Catalogue Book', 'https://tracker.example/catalogue.png?u=ada');
select tests.catalogue_with_cover('Apple Catalogue Book', 'https://is1-ssl.mzstatic.com/image/thumb/b/600x900bb.jpg');
select tests.catalogue_with_cover('Foreign Catalogue Read', 'https://tracker.example/catalogue-read.png', 'finished');
select tests.catalogue_with_cover('Open Library Catalogue Read', 'https://covers.openlibrary.org/b/id/3-L.jpg', 'finished');
insert into ids values ('foreignbook', (select e.book_id from public.library_entries e join public.books b on b.id = e.book_id
                                         where e.member_id = (select id from ids where name = 'ada') and b.title = 'Foreign Catalogue Read'));
select public.share_book_card((select id from ids where name = 'foreignbook'), true);

select tests.act_as((select id from ids where name = 'ben'));
select is(tests.cover_of(public.member_want((select id from ids where name = 'ada')), 'Foreign Catalogue Book'), null, 'her Want to read: a Catalogue cover on a foreign host is not shown');
select is(tests.cover_of(public.member_want((select id from ids where name = 'ada')), 'Apple Catalogue Book'), 'https://is1-ssl.mzstatic.com/image/thumb/b/600x900bb.jpg', 'an Apple Catalogue cover is');
select is(tests.cover_of(public.feed(null, null, 50), 'Foreign Catalogue Book'), null, 'the feed: not shown either');
select is(tests.cover_of(public.feed(null, null, 50), 'Apple Catalogue Book'), 'https://is1-ssl.mzstatic.com/image/thumb/b/600x900bb.jpg', 'an Apple one is');
select is(tests.cover_of(public.member_profile((select id from ids where name = 'ada')) -> 'want', 'Foreign Catalogue Book'), null, 'her profile: Want to read, not shown');
select is(tests.cover_of(public.member_profile((select id from ids where name = 'ada')) -> 'want', 'Apple Catalogue Book'), 'https://is1-ssl.mzstatic.com/image/thumb/b/600x900bb.jpg', 'an Apple one is');
select is(tests.cover_of(public.member_profile((select id from ids where name = 'ada')) -> 'finished', 'Foreign Catalogue Read'), null, 'her profile: finished, not shown');
select is(tests.cover_of(public.member_profile((select id from ids where name = 'ada')) -> 'finished', 'Open Library Catalogue Read'), 'https://covers.openlibrary.org/b/id/3-L.jpg', 'an Open Library one is');
select is(tests.read_of(public.member_reading_record((select id from ids where name = 'ada')), 'Foreign Catalogue Read', 'finished') -> 'entry' -> 'book' -> 'cover_url', 'null'::jsonb, 'her record: not shown');
select is(tests.read_of(public.member_reading_record((select id from ids where name = 'ada')), 'Foreign Catalogue Read', 'finished') -> 'entry' -> 'book' -> 'cover_dominant', 'null'::jsonb, 'nor its colours');
select is(tests.read_of(public.member_reading_record((select id from ids where name = 'ada')), 'Open Library Catalogue Read', 'finished') -> 'entry' -> 'book' ->> 'cover_url', 'https://covers.openlibrary.org/b/id/3-L.jpg', 'an Open Library one is');

select tests.act_anon();
select ok(position('tracker.example' in public.public_reading_page((select link from links where name = 'page'))::text) = 0, 'her public reading page: no Catalogue cover on a foreign host');
select ok(position('covers.openlibrary.org/b/id/3-L.jpg' in public.public_reading_page((select link from links where name = 'page'))::text) > 0, 'but an Open Library Catalogue cover stays');
select ok(position('tracker.example' in coalesce(public.public_book_card((select link from links where name = 'page'),
    (select id from ids where name = 'foreignbook'))::text, '')) = 0,
  'and the shared card of a Catalogue Book on a foreign host carries no cover');
reset role;

-- ------------------------------------- gate 2, fix 3: her current photo, not her folder

insert into storage.objects (bucket_id, name, owner_id)
select 'avatars', (select id from ids where name = 'ada')::text || '/' || repeat(h, 32) || s || '.webp',
       (select id from ids where name = 'ada')::text
  from (values ('a'), ('b')) as hs(h), (values (''), ('-128')) as ss(s);
select tests.act_as((select id from ids where name = 'ada'));
select public.set_avatar((select id from ids where name = 'ada')::text || '/' || repeat('a', 32) || '.webp');

select tests.act_as((select id from ids where name = 'ben'));
select ok(public.can_see_member_file((select id from ids where name = 'ada')::text || '/' || repeat('a', 32) || '.webp'), 'a follower sees her current photo');
select ok(public.can_see_member_file((select id from ids where name = 'ada')::text || '/' || repeat('a', 32) || '-128.webp'), 'and its small twin');
select ok(not public.can_see_member_file((select id from ids where name = 'ada')::text || '/' || repeat('b', 32) || '.webp'), 'not an older photo of hers');
select ok(not public.can_see_member_file((select id from ids where name = 'ada')::text || '/' || repeat('b', 32) || '-128.webp'), 'nor its small twin');
select ok(not public.can_see_member_file((select id from ids where name = 'ada')::text || '/' || repeat('a', 32) || '.jpg'), 'nor the same name in another type');
select ok(not public.can_see_member_file((select id from ids where name = 'ada')::text || '/notes.webp'), 'nor any other name in her folder');
select ok(not public.can_see_member_file(null), 'a null name is no photo');
select is((select count(*)::int from storage.objects where bucket_id = 'avatars' and name like (select id from ids where name = 'ada')::text || '/%'), 2,
  'the policy lets him list her current photo and its twin, and nothing else of her folder');
select tests.act_as((select id from ids where name = 'cy'));
select ok(not public.can_see_member_file((select id from ids where name = 'ada')::text || '/' || repeat('a', 32) || '.webp'), 'a stranger does not see even the current photo');
select is((select count(*)::int from storage.objects where bucket_id = 'avatars' and name like (select id from ids where name = 'ada')::text || '/%'), 0, 'and lists nothing');
select tests.act_as((select id from ids where name = 'dan'));
select ok(not public.can_see_member_file((select id from ids where name = 'ada')::text || '/' || repeat('a', 32) || '.webp'), 'a blocked member does not');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_avatar((select id from ids where name = 'ada')::text || '/' || repeat('b', 32) || '.webp');
select tests.act_as((select id from ids where name = 'ben'));
select ok(public.can_see_member_file((select id from ids where name = 'ada')::text || '/' || repeat('b', 32) || '.webp'), 'a new photo is seen once it is her current one');
select ok(not public.can_see_member_file((select id from ids where name = 'ada')::text || '/' || repeat('a', 32) || '.webp'), 'and the one it replaced is not');

-- ------------------------------------------------------------- signed out

select tests.act_anon();
select is(
  (select count(*)::int from unnest(array[
      'public.feed(timestamptz, uuid, integer)', 'public.member_profile(uuid)', 'public.member_want(uuid)',
      'public.member_reading_record(uuid)', 'public.can_see_member_folder(text)', 'public.can_see_member_file(text)'
    ]) f where has_function_privilege('anon', f::regprocedure, 'execute')),
  0, 'signed out, none of these can be executed');
reset role;

-- ------------------------------------------------------------- removing a follower

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"finished": true}');
select public.remove_follower((select id from ids where name = 'ben'));
select tests.act_as((select id from ids where name = 'ben'));
select ok(not tests.has_book(public.feed(), 'The Left Hand of Darkness'), 'a removed follower sees nothing more of her');

-- --------------------------------------------------------------------- photos

select ok(exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars_select_connected'),
  'photos open to connected members through their own policy');

select tests.act_anon();
select throws_ok($$ select public.feed() $$, '42501', null, 'signed out, there is no feed');

select * from finish();
rollback;
