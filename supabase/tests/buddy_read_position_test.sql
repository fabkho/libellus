-- Buddy reads, D2: a member's Section from her reading progress (docs/plans/buddy-read-shared.md
-- part 5, the table of 5.3, one assertion per row):
--   supabase test db
--
-- A member who linked her copy has a Section that follows its progress: the open session, else the
-- latest closed one on or after the day she joined, as a fraction of the Book (pages over her own
-- total or the edition's, else a percent), and the parts whose end it has reached (half a percent of
-- tolerance). Triggers keep it current: progress, edition, own total, link, the host's division.
-- Unlinking or removing her copy freezes the Section. Everything is driven through the real
-- functions as the member. A member in no read costs one index probe and changes no buddy row. No
-- number about progress reaches another member: they see a Section.

begin;
select plan(60);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-POS-1', 'buddy position test', 100);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-POS-1', 'name', p_name)), now(), now(), now());
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

-- n parts "Section k" ending at k/n, then "The whole book".
create or replace function tests.secs(p_n integer, p_prefix text default 'Section')
returns jsonb language sql as $$
  select jsonb_agg(x order by o)
    from (select k as o, jsonb_build_object('kind', 'part', 'label', p_prefix || ' ' || k,
                                            'to_fraction', round(k::numeric / p_n, 4)) as x
            from generate_series(1, p_n) k
          union all
          select p_n + 1, jsonb_build_object('kind', 'end', 'label', 'The whole book', 'to_fraction', 1)) s
$$;

-- A Catalogue Book's snapshot: the same title is the same Book; editions of one work share its key.
create or replace function tests.bk(p_title text, p_pages integer default null, p_work text default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'title', p_title, 'authors', jsonb_build_array('An Author'), 'source', 'apple',
    'apple_id', (9810000000 + ('x' || substr(md5(p_title), 1, 7))::bit(28)::int)::text,
    'page_count', p_pages,
    'openlibrary_work_key', case when p_work is not null
      then 'OL' || (9810000 + ('x' || substr(md5(p_work), 1, 5))::bit(20)::int)::text || 'W' end))
$$;

create or replace function tests.keys(p jsonb)
returns text[] language sql as $$ select array(select jsonb_object_keys(p) order by 1) $$;

create or replace function tests.card(p_read jsonb, p_member uuid)
returns jsonb language sql as $$
  select c from jsonb_array_elements(p_read -> 'members') c where c ->> 'id' = p_member::text
$$;

create or replace function tests.member_row(p_read uuid, p_member uuid)
returns jsonb language sql security definer as $$
  select to_jsonb(m) from public.buddy_read_members m where m.buddy_read_id = p_read and m.member_id = p_member
$$;

create or replace function tests.follow(p_follower uuid, p_followee uuid)
returns void language sql security definer as $$
  insert into public.follows (follower_id, followee_id, accepted_at) values (p_follower, p_followee, now())
  on conflict (follower_id, followee_id) do update set accepted_at = now(), declined_at = null
$$;

-- Her numbers, past RLS.
create or replace function tests.auto(p_read uuid, p_member uuid)
returns integer language sql security definer as $$
  select auto_through from public.buddy_read_members where buddy_read_id = p_read and member_id = p_member
$$;
create or replace function tests.hand(p_read uuid, p_member uuid)
returns integer language sql security definer as $$
  select hand_through from public.buddy_read_members where buddy_read_id = p_read and member_id = p_member
$$;
create or replace function tests.thru(p_read uuid, p_member uuid)
returns integer language sql security definer as $$
  select read_through from public.buddy_read_members where buddy_read_id = p_read and member_id = p_member
$$;
create or replace function tests.entry_of(p_read uuid, p_member uuid)
returns uuid language sql security definer as $$
  select entry_id from public.buddy_read_members where buddy_read_id = p_read and member_id = p_member
$$;
create or replace function tests.open_session(p_entry uuid)
returns uuid language sql security definer as $$
  select id from public.reading_sessions where entry_id = p_entry and outcome is null
$$;
-- Every buddy member row's version: a progress update that changes none leaves this as it was.
create or replace function tests.member_rows_version()
returns text language sql security definer as $$
  select coalesce(string_agg(buddy_read_id || ':' || member_id || ':' || xmin::text, ',' order by buddy_read_id, member_id), '')
    from public.buddy_read_members
$$;

-- Where she is, as another member of the read sees it: the card's `where`.
create or replace function tests.where_for(p_read uuid, p_viewer uuid, p_member uuid)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.act_as(p_viewer);
  select public.buddy_read(p_read) into v;
  reset role;
  return tests.card(v, p_member) -> 'where';
end;
$$;

-- A room: a host and a member of a fresh read of one Book, each with a copy in her Library (the
-- member's edition has p_member_pages when that is given: another edition of the same work), the
-- member joined by the link and, when asked, her copy linked. Through the real functions.
create or replace function tests.room(p_tag text, p_pages integer, p_parts integer default 4,
                                      p_member_pages integer default null, p_link boolean default true)
returns table (h uuid, m uuid, rd uuid, he uuid, me uuid)
language plpgsql as $$
declare
  v_h     uuid := tests.member(p_tag || '-host@pos.test', 'Host ' || p_tag);
  v_m     uuid := tests.member(p_tag || '-member@pos.test', 'Member ' || p_tag);
  v_work  text := case when p_member_pages is not null then p_tag end;
  v_hbook jsonb := tests.bk('Book ' || p_tag, p_pages, v_work);
  v_mbook jsonb := case when p_member_pages is null then v_hbook
                        else tests.bk('Book ' || p_tag || ' (hers)', p_member_pages, v_work) end;
  v_he    uuid;
  v_me    uuid;
  v_read  jsonb;
begin
  perform tests.act_as(v_h);
  v_he := (public.add_to_library(v_hbook)).id;
  v_read := public.create_buddy_read((select book_id from public.library_entries where id = v_he),
                                     gen_random_uuid(), tests.secs(p_parts), '{}', true);
  perform tests.act_as(v_m);
  v_me := (public.add_to_library(v_mbook)).id;
  perform public.join_buddy_read(v_read ->> 'link_token');
  if p_link then
    perform public.link_buddy_entry((v_read ->> 'id')::uuid, v_me);
  end if;
  reset role;
  return query select v_h, v_m, (v_read ->> 'id')::uuid, v_he, v_me;
end;
$$;

select (now() at time zone 'utc')::date as today \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- ------------------------------------------------------------------------- the rows of plan 5.3

-- Pages: the read's edition has 400, hers 380.
select * from tests.room('pg', 400, 4, 380) \gset pg_
select tests.act_as(:'pg_m');
select public.start_reading(:'pg_me', :'today'::date);
reset role;
select is(tests.auto(:'pg_rd', :'pg_m'), 0, 'a read that has begun, with no progress yet, completes no Section');
select tests.act_as(:'pg_m');
select public.update_progress(:'pg_me', 190);
reset role;
select is(tests.auto(:'pg_rd', :'pg_m'), 2,
  'pages: 190 of her 380 is 0.5, which completes the two Sections ending at 0.25 and 0.5 although the read''s edition has 400');
select is(tests.where_for(:'pg_rd', :'pg_h', :'pg_m'), '{"kind": "section", "section": 3}'::jsonb,
  'and the host sees her in Section 3');

-- Percent: no page count anywhere.
select * from tests.room('pc', null) \gset pc_
select tests.act_as(:'pc_m');
select public.start_reading(:'pc_me', :'today'::date);
select public.update_progress(:'pc_me', null, 55);
reset role;
select is(tests.auto(:'pc_rd', :'pc_m'), 2, 'percent: 55 % completes the Sections ending at 0.25 and 0.5, not 0.75');
select is(tests.thru(:'pc_rd', :'pc_m'), 2, 'which is her read_through');

-- A page, but no page count anywhere.
select * from tests.room('np', null) \gset np_
select tests.act_as(:'np_m');
select public.start_reading(:'np_me', :'today'::date);
select public.update_progress(:'np_me', 120);
reset role;
select is(tests.auto(:'np_rd', :'np_m'), null, 'a page with no page count anywhere: no automatic position');
select tests.act_as(:'np_m');
select public.set_buddy_hand(:'np_rd', 2);
reset role;
select is(tests.thru(:'np_rd', :'np_m'), 2, 'the hand override works then');

-- Finished.
select * from tests.room('fi', 300) \gset fi_
select tests.act_as(:'fi_m');
select public.start_reading(:'fi_me', :'today'::date - 3);
select public.update_progress(:'fi_me', 100);
select public.finish_reading(:'fi_me', :'today'::date);
reset role;
select is(tests.auto(:'fi_rd', :'fi_m'), 4, 'finished: every part is read');
select is(tests.where_for(:'fi_rd', :'fi_h', :'fi_m'), '{"kind": "end"}'::jsonb, 'and the whole book is open: the host sees `end`');

-- Abandoned: frozen at its last progress when it ended on or after she joined; not counted before.
select * from tests.room('ab', 300) \gset ab_
select tests.act_as(:'ab_m');
select public.start_reading(:'ab_me', :'today'::date - 3);
select public.update_progress(:'ab_me', 150);
reset role;
select tests.auto(:'ab_rd', :'ab_m') as ab_before \gset
select tests.act_as(:'ab_m');
select public.abandon_reading(:'ab_me', :'today'::date, 'too long');
reset role;
select is(tests.auto(:'ab_rd', :'ab_m'), :'ab_before'::int,
  'abandoned the day she joined: her Section stays where its last progress put it');
select is(tests.auto(:'ab_rd', :'ab_m'), 2, 'which is the Section at half of the book');
select is(tests.where_for(:'ab_rd', :'ab_h', :'ab_m'), '{"kind": "section", "section": 3}'::jsonb,
  'the others see her Section, never that she gave up');
select * from tests.room('a2', 300) \gset a2_
select tests.act_as(:'a2_m');
select public.start_reading(:'a2_me', :'today'::date - 10);
select public.update_progress(:'a2_me', 150);
select public.abandon_reading(:'a2_me', :'today'::date - 5);
reset role;
select is(tests.auto(:'a2_rd', :'a2_m'), null, 'abandoned before she joined: not counted');

-- An older finished session.
select * from tests.room('of', 300) \gset of_
select tests.act_as(:'of_m');
select public.start_reading(:'of_me', :'today'::date - 10);
reset role;
select tests.auto(:'of_rd', :'of_m') as of_open \gset
select tests.act_as(:'of_m');
select public.finish_reading(:'of_me', :'today'::date - 5);
reset role;
select is(:'of_open'::int, 0, 'the read she is in counts while it is open');
select is(tests.auto(:'of_rd', :'of_m'), null, 'finished before she joined: not counted, nothing is opened silently');
select is(tests.where_for(:'of_rd', :'of_h', :'of_m'), '{"kind": "section", "section": 1}'::jsonb,
  'she is shown in Section 1: her copy is linked, her place is the start');

-- A re-read after a finish.
select * from tests.room('rr', 300) \gset rr_
select tests.act_as(:'rr_m');
select public.start_reading(:'rr_me', :'today'::date - 3);
select public.finish_reading(:'rr_me', :'today'::date);
reset role;
select tests.auto(:'rr_rd', :'rr_m') as rr_done \gset
select tests.act_as(:'rr_m');
select public.read_again(:'rr_me', :'today'::date);
reset role;
select is(:'rr_done'::int, 4, 'the finish opened every part');
select is(tests.auto(:'rr_rd', :'rr_m'), 0, 're-read: the open session wins and her Section falls back');
select tests.act_as(:'rr_m');
select public.set_buddy_hand(:'rr_rd', 4);
reset role;
select is(tests.thru(:'rr_rd', :'rr_m'), 4, 'her hand ("I''ve read it") is the remedy');

-- Edition changed, to one with another page count.
select * from tests.room('ed', 400) \gset ed_
select tests.act_as(:'ed_m');
select public.start_reading(:'ed_me', :'today'::date);
select public.update_progress(:'ed_me', 150);
reset role;
select tests.auto(:'ed_rd', :'ed_m') as ed_before \gset
select tests.act_as(:'ed_m');
select public.change_edition(:'ed_me', tests.bk('Book ed, another edition', 300));
reset role;
select is(:'ed_before'::int, 1, 'page 150 of 400 is 0.375: one Section');
select is(tests.auto(:'ed_rd', :'ed_m'), 2, 'edition change: page 150 of the new edition''s 300 is 0.5, two Sections');

-- Her own total, set and cleared.
select * from tests.room('ov', 400) \gset ov_
select tests.act_as(:'ov_m');
select public.start_reading(:'ov_me', :'today'::date);
select public.update_progress(:'ov_me', 100);
reset role;
select tests.auto(:'ov_rd', :'ov_m') as ov_before \gset
select tests.act_as(:'ov_m');
select public.update_progress(:'ov_me', null, null, true, 200);
reset role;
select tests.auto(:'ov_rd', :'ov_m') as ov_set \gset
select tests.act_as(:'ov_m');
select public.update_progress(:'ov_me', null, null, true, null);
reset role;
select is(:'ov_before'::int, 1, 'page 100 of 400 is 0.25: one Section');
select is(:'ov_set'::int, 2, 'page_count_override set to 200: 0.5, two Sections');
select is(tests.auto(:'ov_rd', :'ov_m'), 1, 'cleared: back to the edition''s 400');

-- Her entry removed from the Library, or unlinked.
select * from tests.room('rm', 300) \gset rm_
select tests.act_as(:'rm_m');
select public.start_reading(:'rm_me', :'today'::date);
select public.update_progress(:'rm_me', 150);
reset role;
select tests.auto(:'rm_rd', :'rm_m') as rm_before \gset
select tests.act_as(:'rm_m');
select public.remove_from_library(:'rm_me');
reset role;
select is(:'rm_before'::int, 2, 'she was in Section 3');
select is(tests.entry_of(:'rm_rd', :'rm_m'), null, 'entry removed: the link is gone');
select is(tests.hand(:'rm_rd', :'rm_m'), 2, 'her hand is frozen at where she was');
select is(tests.auto(:'rm_rd', :'rm_m'), null, 'and nothing automatic is left');
select is(tests.where_for(:'rm_rd', :'rm_h', :'rm_m'), '{"kind": "section", "section": 3}'::jsonb,
  'the others still see her in Section 3: nothing opened or closed');
select * from tests.room('ul', 300) \gset ul_
select tests.act_as(:'ul_m');
select public.start_reading(:'ul_me', :'today'::date);
select public.update_progress(:'ul_me', 165);
select public.link_buddy_entry(:'ul_rd', null);
reset role;
select is(tests.hand(:'ul_rd', :'ul_m'), 2, 'unlinked: her hand is frozen at where she was (55 %: two Sections)');
select tests.act_as(:'ul_m');
select public.update_progress(:'ul_me', 270);
reset role;
select is(tests.thru(:'ul_rd', :'ul_m'), 2, 'and later progress moves nothing: the copy is no longer linked');

-- No linked entry, nothing set.
select * from tests.room('nl', 300, 4, null, false) \gset nl_
select is(tests.where_for(:'nl_rd', :'nl_h', :'nl_m'), '{"kind": "not_set"}'::jsonb, 'no copy linked and nothing set: `not_set`');
select is(tests.auto(:'nl_rd', :'nl_m'), null, 'with no automatic position either');

-- Hand above auto, hand below auto.
select * from tests.room('ha', 300) \gset ha_
select tests.act_as(:'ha_m');
select public.start_reading(:'ha_me', :'today'::date);
select public.update_progress(:'ha_me', 75);
select public.set_buddy_hand(:'ha_rd', 3);
reset role;
select is(tests.thru(:'ha_rd', :'ha_m'), 3, 'hand above auto: the hand wins');
select is(tests.auto(:'ha_rd', :'ha_m'), 1, 'while her progress still says one');
select * from tests.room('hb', 300) \gset hb_
select tests.act_as(:'hb_m');
select public.start_reading(:'hb_me', :'today'::date);
select public.update_progress(:'hb_me', 150);
select public.set_buddy_hand(:'hb_rd', 1);
reset role;
select is(tests.thru(:'hb_rd', :'hb_m'), 2, 'hand below auto: her progress wins, a hand never hides what it opened');

-- Progress corrected downwards.
select * from tests.room('dn', 300) \gset dn_
select tests.act_as(:'dn_m');
select public.start_reading(:'dn_me', :'today'::date);
select public.update_progress(:'dn_me', 270);
reset role;
select tests.auto(:'dn_rd', :'dn_m') as dn_before \gset
select tests.act_as(:'dn_m');
select public.update_progress(:'dn_me', 90);
reset role;
select is(:'dn_before'::int, 3, 'page 270 of 300: three Sections');
select is(tests.auto(:'dn_rd', :'dn_m'), 1, 'corrected downwards to page 90: her Section follows down');

-- The boundary: to_fraction 0.5000.
select * from tests.room('bd', 10000, 2) \gset bd_
select tests.act_as(:'bd_m');
select public.start_reading(:'bd_me', :'today'::date);
select public.update_progress(:'bd_me', 4950);
reset role;
select tests.auto(:'bd_rd', :'bd_m') as bd_at \gset
select tests.act_as(:'bd_m');
select public.update_progress(:'bd_me', 4949);
reset role;
select is(:'bd_at'::int, 1, 'boundary: 0.4950 completes the Section ending at 0.5000');
select is(tests.auto(:'bd_rd', :'bd_m'), 0, 'and 0.4949 does not');

-- The host replaces the division: everyone is recomputed, the hand is clamped.
select * from tests.room('rp', 400) \gset rp_
select tests.act_as(:'rp_h');
select public.start_reading(:'rp_he', :'today'::date);
select public.update_progress(:'rp_he', 200);
select tests.act_as(:'rp_m');
select public.start_reading(:'rp_me', :'today'::date);
select public.update_progress(:'rp_me', 200);
select public.set_buddy_hand(:'rp_rd', 4);
reset role;
select is(tests.auto(:'rp_rd', :'rp_h'), 2, 'the host at half the book, in four Sections: two');
select tests.act_as(:'rp_h');
select public.set_buddy_sections(:'rp_rd', tests.secs(2));
reset role;
select is(tests.auto(:'rp_rd', :'rp_h'), 1, 'the host replaces the division by two: her Section is recomputed');
select is(tests.auto(:'rp_rd', :'rp_m'), 1, 'and every member''s');
select is(tests.hand(:'rp_rd', :'rp_m'), 2, 'a hand above the new number is clamped to it');
select tests.act_as(:'rp_h');
select public.set_buddy_sections(:'rp_rd', tests.secs(10));
reset role;
select is(tests.auto(:'rp_rd', :'rp_m'), 5, 'replaced by ten: half the book is five Sections');

-- create_buddy_read for a host whose entry already has progress.
select tests.member('cr-host@pos.test', 'Host cr') as cr_h \gset
select tests.act_as(:'cr_h');
select (public.add_to_library(tests.bk('Book cr'))).id as cr_he \gset
select public.start_reading(:'cr_he', :'today'::date);
select public.update_progress(:'cr_he', null, 60);
select public.create_buddy_read((select book_id from public.library_entries where id = :'cr_he'),
  gen_random_uuid(), tests.secs(4)) ->> 'id' as cr_rd \gset
reset role;
select is(tests.auto(:'cr_rd'::uuid, :'cr_h'), 2, 'a read created by a host who is already at 60 %: her Section is right from the start');

-- A session that counts is deleted.
select * from tests.room('ds', 300) \gset ds_
select tests.act_as(:'ds_m');
select public.start_reading(:'ds_me', :'today'::date);
select public.update_progress(:'ds_me', 150);
select public.delete_session(tests.open_session(:'ds_me'));
reset role;
select is(tests.auto(:'ds_rd', :'ds_m'), null, 'deleting the session that counted leaves no automatic position');

-- ------------------------------------------------------------------------- the acceptance walk

select * from tests.room('ac', 300) \gset ac_
select tests.act_as(:'ac_m');
select public.start_reading(:'ac_me', :'today'::date);
select public.update_progress(:'ac_me', null, 55);
select public.buddy_read(:'ac_rd') -> 'me' as ac_me_json \gset
select public.link_buddy_entry(:'ac_rd', null);
select public.buddy_read(:'ac_rd') -> 'me' as ac_me_unlinked \gset
reset role;
select is(:'ac_me_json'::jsonb -> 'read_through', '2'::jsonb, 'her own view: read_through 2 at 55 % of four parts');
select is(:'ac_me_json'::jsonb -> 'where', '{"kind": "section", "section": 3}'::jsonb, 'where is Section 3');
select is(:'ac_me_unlinked'::jsonb -> 'where', '{"kind": "section", "section": 3}'::jsonb, 'unlinked: her Section stays at 3');
select tests.act_as(:'ac_m');
select public.link_buddy_entry(:'ac_rd', :'ac_me');
select public.finish_reading(:'ac_me', :'today'::date);
select public.buddy_read(:'ac_rd') -> 'me' -> 'where' as ac_end \gset
reset role;
select is(:'ac_end'::jsonb, '{"kind": "end"}'::jsonb, 'linked again and finished: `end`');

-- ------------------------------------------------------------------------- what the others never see

select tests.act_as(:'pg_h');
select public.buddy_read(:'pg_rd') as pg_host_view \gset
reset role;
select is(tests.keys(tests.card(:'pg_host_view'::jsonb, :'pg_m')) && array['progress', 'page', 'percent', 'fraction',
  'ended_on', 'entry_id', 'hand', 'auto', 'read_through', 'auto_through', 'hand_through'], false,
  'a co-member''s card has none of the keys progress, page, percent, fraction, ended_on, entry_id, hand, auto');
select is((:'pg_host_view'::jsonb -> 'members')::text ~ '"(progress|page|percent|fraction|ended_on|entry_id|hand|auto|read_through)[a-z_]*" *:', false,
  'nor does any key of the members list start with them');
select is(tests.keys(tests.where_for(:'pg_rd', :'pg_h', :'pg_m')), array['kind', 'section'],
  'her `where` is a kind and a Section number, nothing else');
select tests.act_as(:'pg_m');
select public.buddy_read(:'pg_rd') as pg_member_view \gset
reset role;
select is(tests.keys(tests.card(:'pg_member_view'::jsonb, :'pg_h')) && array['progress', 'page', 'percent', 'fraction',
  'ended_on', 'entry_id', 'hand', 'auto', 'read_through', 'auto_through', 'hand_through'], false,
  'and the host''s card, in the member''s view, has none either');

-- A follower sees no progress.
select tests.member('fo@pos.test', 'Fo') as fo \gset
select tests.follow(:'fo', :'pg_m');
select tests.act_as(:'fo');
select ok(public.member_profile(:'pg_m')::text !~ '(read_through|hand_through|auto_through|progress_page|progress_percent|buddy)',
  'a follower''s view of the member carries no progress and nothing of her buddy read');
select ok(coalesce(public.feed()::text, '') !~ '(read_through|hand_through|auto_through|progress_page|progress_percent|buddy)',
  'nor the feed');
reset role;

-- ------------------------------------------------------------------------- a member in no read

select tests.member('nox@pos.test', 'Nox') as nox \gset
select tests.act_as(:'nox');
select (public.add_to_library(tests.bk('Book nox', 300))).id as nox_e \gset
select public.start_reading(:'nox_e', :'today'::date);
reset role;
select tests.member_rows_version() as v_before \gset
select tests.act_as(:'nox');
select public.update_progress(:'nox_e', 120);
select public.update_progress(:'nox_e', 150);
reset role;
select is(tests.member_rows_version(), :'v_before', 'a progress update by a member in no read writes no buddy row');

-- ------------------------------------------------------------------------- grants

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('buddy_fraction', 'buddy_refresh', 'buddy_refresh_entry', 'buddy_refresh_read', 'buddy_on_session',
                        'buddy_on_entry', 'buddy_on_member_link', 'buddy_on_member_unlink', 'buddy_on_sections_inserted',
                        'buddy_on_sections_updated', 'buddy_on_sections_deleted')
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
  0, 'no member and no visitor may run a refresh or a trigger function');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('buddy_fraction', 'buddy_refresh', 'buddy_refresh_entry', 'buddy_refresh_read', 'buddy_on_session',
                        'buddy_on_entry', 'buddy_on_member_link', 'buddy_on_member_unlink', 'buddy_on_sections_inserted',
                        'buddy_on_sections_updated', 'buddy_on_sections_deleted')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  0, 'every one of them pins its search_path');

select * from finish();
rollback;
