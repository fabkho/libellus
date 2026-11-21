-- A member's whole finished history, a page at a time (the shelf page's stack):
--   supabase test db
--
-- member_finished(member, after, limit) is the read the shelf page uses where member_profile's `finished`
-- stops at 12. A member with more than that is the point of the file: her first page comes back full, the
-- keyset walks past it and the pages together are her whole history, each row once, in the profile's order
-- (ended_on desc nulls last, created_at desc, entry_id). Her *Finished* switch off means the read does not
-- happen at all (null, as member_want answers with Want to read off); a hidden entry is never in it; a
-- stranger, a blocked member and a member whose request waits find nothing; ratings and reviews follow her
-- switches; a cursor is checked before anything is read. Assertions ask about rows this test made.

begin;
select plan(36);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-SHELF-1', 'member shelf test', 10);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-SHELF-1', 'name', p_name)), now(), now(), now());
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

-- A finished read of a Book of her own, ended on the day given.
create or replace function tests.finished_on(p_title text, p_ended date)
returns uuid language plpgsql as $$
declare v_entry uuid;
begin
  v_entry := (public.add_to_library(tests.snap(p_title), 'reading', p_ended - 3)).id;
  perform public.finish_reading(v_entry, p_ended, 16, null);
  return v_entry;
end;
$$;

-- The titles this list holds, in the order it has them.
create or replace function tests.titles(p_list jsonb)
returns text[] language sql as $$
  select coalesce(array_agg(item -> 'book' ->> 'title' order by n), '{}')
    from (select item, row_number() over () as n
            from jsonb_array_elements(coalesce(p_list -> 'items', '[]')) as q(item)) x
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, anon;

-- Walk the keyset to the end, as the shelf page does, and keep every title it hands out in order.
create temporary table walked (title text, n integer) on commit drop;
grant all on walked to authenticated, anon;
create or replace function tests.walk(p_member uuid, p_limit integer)
returns integer language plpgsql as $$
declare
  v_after jsonb := null;
  v_page  jsonb;
  v_n     integer := 0;
  v_seen  integer := 0;
begin
  delete from walked;
  loop
    v_page := public.member_finished(p_member, v_after, p_limit);
    insert into walked (title, n)
      select item -> 'book' ->> 'title', v_n + row_number() over ()
        from jsonb_array_elements(v_page -> 'items') as q(item);
    v_n := v_n + jsonb_array_length(v_page -> 'items');
    v_after := v_page -> 'next';
    v_seen := v_seen + 1;
    exit when v_after is null or jsonb_typeof(v_after) = 'null';
    -- A guard no real history reaches: the walk must end rather than loop on a cursor the pages repeat.
    if v_seen > 100 then raise exception 'walk did not end'; end if;
  end loop;
  return v_n;
end;
$$;
grant execute on function tests.walk(uuid, integer) to anon, authenticated;


insert into ids values
  ('ada', tests.member('ada@shelf.pgtap.test', 'Ada')),
  ('ben', tests.member('ben@shelf.pgtap.test', 'Ben')),
  ('cy',  tests.member('cy@shelf.pgtap.test', 'Cy')),
  ('dan', tests.member('dan@shelf.pgtap.test', 'Dan'));

update private.social_config set settle_window = interval '0';

-- Ada has fifteen finished Books, one of them hidden: more than the twelve her profile carries.
select tests.act_as((select id from ids where name = 'ada'));
insert into ids values
  ('b01', tests.finished_on('The First', date '2026-01-01')),
  ('b02', tests.finished_on('The Second', date '2026-01-02')),
  ('b03', tests.finished_on('The Third', date '2026-01-03')),
  ('b04', tests.finished_on('The Fourth', date '2026-01-04')),
  ('b05', tests.finished_on('The Fifth', date '2026-01-05')),
  ('b06', tests.finished_on('The Sixth', date '2026-01-06')),
  ('b07', tests.finished_on('The Seventh', date '2026-01-07')),
  ('b08', tests.finished_on('The Eighth', date '2026-01-08')),
  ('b09', tests.finished_on('The Ninth', date '2026-01-09')),
  ('b10', tests.finished_on('The Tenth', date '2026-01-10')),
  ('b11', tests.finished_on('The Eleventh', date '2026-01-11')),
  ('b12', tests.finished_on('The Twelfth', date '2026-01-12')),
  ('b13', tests.finished_on('The Thirteenth', date '2026-01-13')),
  ('b14', tests.finished_on('The Fourteenth', date '2026-01-14')),
  ('b15', tests.finished_on('The Fifteenth', date '2026-01-15'));
select public.set_entry_hidden((select id from ids where name = 'b08'), true);

-- Ben follows her; Dan asked and waits. Her account is private, so nobody else sees her.
reset role;
insert into public.follows (follower_id, followee_id, accepted_at) values
  ((select id from ids where name = 'ben'), (select id from ids where name = 'ada'), now()),
  ((select id from ids where name = 'dan'), (select id from ids where name = 'ada'), null);

-- ------------------------------------------------------- what her profile stops at, and what this reads

select tests.act_as((select id from ids where name = 'ben'));
select is(jsonb_array_length(public.member_profile((select id from ids where name = 'ada')) -> 'finished'), 12,
  'her profile still hands out the newest 12 finished reads, and no more (the payload every profile load pays)');
select is(jsonb_typeof(public.member_profile((select id from ids where name = 'ada')) -> 'counts' -> 'read'), 'number',
  'while it knows how many she has');
select is((public.member_profile((select id from ids where name = 'ada')) -> 'counts' -> 'read')::text, '14',
  'the hidden Book is not in that count either');

select is((public.member_finished((select id from ids where name = 'ada')) ->> 'total')::integer, 14,
  'member_finished counts the same finished reads');
select is(jsonb_array_length(public.member_finished((select id from ids where name = 'ada')) -> 'items'), 14,
  'and hands all of them out in one page when they fit one');
select is(tests.titles(public.member_finished((select id from ids where name = 'ada'))), array[
         'The Fifteenth', 'The Fourteenth', 'The Thirteenth', 'The Twelfth', 'The Eleventh', 'The Tenth',
         'The Ninth', 'The Seventh', 'The Sixth', 'The Fifth', 'The Fourth', 'The Third', 'The Second', 'The First'],
  'newest read first, and the hidden Book (The Eighth) never in it');
select is((public.member_finished((select id from ids where name = 'ada')) -> 'next'), 'null'::jsonb,
  'one page of 14: no cursor');

-- ------------------------------------------------------------- a page, and the page after it

select is(jsonb_array_length(public.member_finished((select id from ids where name = 'ada'), null, 5) -> 'items'), 5,
  'p_limit asks for a page of five');
select is((public.member_finished((select id from ids where name = 'ada'), null, 5) -> 'next') ?& array['day', 'at', 'entry'],
  true, 'and answers where the next one starts (day, at, entry)');
select is(tests.titles(public.member_finished((select id from ids where name = 'ada'), null, 5)), array[
         'The Fifteenth', 'The Fourteenth', 'The Thirteenth', 'The Twelfth', 'The Eleventh'],
  'the first page: the five newest');

select tests.act_as((select id from ids where name = 'ben'));
select is(tests.walk((select id from ids where name = 'ada'), 5), 14,
  'a page of five walks past the first one and returns all 14, none twice');
select is((select array_agg(title order by n) from walked), array[
         'The Fifteenth', 'The Fourteenth', 'The Thirteenth', 'The Twelfth', 'The Eleventh', 'The Tenth',
         'The Ninth', 'The Seventh', 'The Sixth', 'The Fifth', 'The Fourth', 'The Third', 'The Second', 'The First'],
  'in the same order the one page has, newest read first');

select is(tests.walk((select id from ids where name = 'ada'), 13), 14,
  'a page of 13 has its second page carry the one row left');
select is((select title from walked where n = 14), 'The First', 'which is her oldest read');

select is(tests.walk((select id from ids where name = 'ada'), 1), 14, 'a page of one walks the whole history too');
select is((select count(*)::integer from (select distinct title from walked) d), 14, 'and repeats no row');

-- A tie on the read's end (the reads in one call share a second, and the day) still pages: the entry's id
-- breaks it, so none of them is skipped or shown twice.
select tests.act_as((select id from ids where name = 'cy'));
insert into ids values
  ('c1', tests.finished_on('Same Day A', date '2026-03-01')),
  ('c2', tests.finished_on('Same Day B', date '2026-03-01')),
  ('c3', tests.finished_on('Same Day C', date '2026-03-01')),
  ('c4', tests.finished_on('Same Day D', date '2026-03-01'));
select public.set_private(false);
select tests.act_as((select id from ids where name = 'ben'));
select is(tests.walk((select id from ids where name = 'cy'), 1), 4, 'four reads ending the same day: one page of one walks all four');
select is((select count(*)::integer from (select distinct title from walked) d), 4, 'each of them once');

-- A read with no end date sorts last, behind every dated one, as her profile has it (`ended_on desc nulls last`).
select tests.act_as((select id from ids where name = 'cy'));
reset role;
update public.reading_sessions set ended_on = null
 where entry_id = (select id from ids where name = 'c2');
select tests.act_as((select id from ids where name = 'ben'));
select is((tests.titles(public.member_finished((select id from ids where name = 'cy'))))[4], 'Same Day B',
  'a read with no end date stands last');
select is(tests.walk((select id from ids where name = 'cy'), 1), 4, 'and pages there too');

-- --------------------------------------------------------------- her switch, and who may ask

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"finished": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is(public.member_finished((select id from ids where name = 'ada')) is null, true,
  'her *Finished* switch off: the read does not happen at all (null), so the shelf page keeps its quiet state');
select is(public.member_finished((select id from ids where name = 'ada'), null, 5) is null, true,
  'not even a page of it');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"finished": true}');
select tests.act_as((select id from ids where name = 'ben'));
select is((public.member_finished((select id from ids where name = 'ada')) ->> 'total')::integer, 14, 'switched back on: her history is back');

-- A stranger, a member whose request waits, and a blocked member find nothing.
select tests.act_as((select id from ids where name = 'cy'));
select is(public.member_finished((select id from ids where name = 'ada')) is null, true, 'a stranger finds no finished read of a private member');
select tests.act_as((select id from ids where name = 'dan'));
select public.follow((select id from ids where name = 'ada'));
select is(public.member_finished((select id from ids where name = 'ada')) is null, true, 'a member whose request waits finds none');
select tests.act_as((select id from ids where name = 'ada'));
select public.block((select id from ids where name = 'dan'));
select tests.act_as((select id from ids where name = 'dan'));
select is(public.member_finished((select id from ids where name = 'ada')) is null, true, 'a blocked member finds none');
select tests.act_as((select id from ids where name = 'ada'));
select public.unblock((select id from ids where name = 'dan'));
select public.set_private(false);
select tests.act_as((select id from ids where name = 'dan'));
select is((public.member_finished((select id from ids where name = 'ada')) ->> 'total')::integer, 14,
  'a public member''s history is anyone''s (a stranger''s ask is not needed)');
select tests.act_as((select id from ids where name = 'ada'));
select public.set_private(true);

-- --------------------------------------------------------------- her switches over a row, and a cursor

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"ratings": false, "reviews": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is((public.member_finished((select id from ids where name = 'ada')) -> 'items' -> 0) -> 'rating', 'null'::jsonb,
  'Ratings off: a row has none');
select is((public.member_finished((select id from ids where name = 'ada')) -> 'items' -> 0) -> 'review', 'null'::jsonb,
  'Reviews off: a row has none');
select is((public.member_finished((select id from ids where name = 'ada')) -> 'items' -> 0) ?& array['book', 'endedOn', 'rating', 'review', 'sessionId', 'spoilers', 'folded', 'likes', 'liked'],
  true, 'and every row has the shape member_profile''s finished rows have');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_social_sections('{"ratings": true, "reviews": true}');
select tests.act_as((select id from ids where name = 'ben'));
select is((public.member_finished((select id from ids where name = 'ada')) -> 'items' -> 0) -> 'rating', '16'::jsonb, 'and back on it is her rating');

-- A cursor of the wrong shape is refused before anything is read; a JSON null is the first page.
select throws_ok(
  format($$select public.member_finished(%L, '"nope"'::jsonb)$$, (select id from ids where name = 'ada')),
  '22023', 'after_invalid', 'a cursor that is no object is after_invalid');
select throws_ok(
  format($$select public.member_finished(%L, '{"day": "x", "at": "y", "entry": "z"}'::jsonb)$$, (select id from ids where name = 'ada')),
  '22023', 'after_invalid', 'and so is one whose parts do not read');
select is(jsonb_array_length(public.member_finished((select id from ids where name = 'ada'), 'null'::jsonb) -> 'items'), 14,
  'a JSON null cursor is the first page, as a SQL null is');
select is(jsonb_array_length(public.member_finished((select id from ids where name = 'ada'), null, 1000) -> 'items'), 14,
  'p_limit over the clamp is clamped, not refused');

-- Who may ask at all: a signed-in member, and nobody else.
select tests.act_anon();
select throws_ok(
  format($$select public.member_finished(%L)$$, (select id from ids where name = 'ada')),
  '42501', null, 'an anonymous visitor is refused');

select * from finish();
rollback;
