-- Profile links (WP-22, 20261028010000_profile_links.sql):
--   supabase test db
--
-- A member keeps a validated handle or id for each of five platforms (Goodreads, Reado, YouTube,
-- Instagram, TikTok), never a URL: what she types is cleaned (an @ off, lower case where the platform
-- ignores case) and checked per platform, on the server and again by the table. The cap of five is the
-- primary key over a five-value enum, and one call writes the whole list or nothing. At most 10 calls
-- an hour. Who sees her links is her setting: her followers (the default), everyone who can see her
-- profile, or only herself; a requester, a stranger and a blocked member in either direction never do,
-- and see an empty list rather than a refusal. They go with the account. The owner's action refuses
-- everyone but the owner. Assertions ask about the rows this test made, never counts of a table.

begin;
select plan(109);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-PLINKS', 'profile links test', 40);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-PLINKS', 'name', p_name)), now(), now(), now());
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

create or replace function tests.name_owner(p_id uuid)
returns void language sql security definer as $$
  update private.instance_owner set owner_id = p_id
$$;

-- Past RLS: how many links a member holds, and how many calls the hourly limit has counted.
create or replace function tests.held(p_member uuid)
returns bigint language sql security definer as $$
  select count(*) from public.profile_links where member_id = p_member
$$;
create or replace function tests.settings_held(p_member uuid)
returns bigint language sql security definer as $$
  select count(*) from public.profile_link_settings where member_id = p_member
$$;
create or replace function tests.calls_held(p_member uuid)
returns bigint language sql security definer as $$
  select count(*) from private.profile_link_calls where member_id = p_member
$$;
create or replace function tests.forget_calls(p_member uuid)
returns void language sql security definer as $$
  delete from private.profile_link_calls where member_id = p_member
$$;

-- One platform's list as a call argument.
create or replace function tests.one(p_platform text, p_handle text)
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('platform', p_platform, 'handle', p_handle))
$$;

-- Whether a list holds this platform with this handle.
create or replace function tests.has(p_list jsonb, p_platform text, p_handle text)
returns boolean language sql as $$
  select coalesce(p_list @> jsonb_build_array(jsonb_build_object('platform', p_platform, 'handle', p_handle)), false)
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create temporary table ids (name text primary key, id uuid) on commit drop;
grant select on ids to authenticated, anon;

insert into ids values
  ('ada', tests.member('ada@plinks.pgtap.test', 'Ada')),   -- private, the one with links
  ('pia', tests.member('pia@plinks.pgtap.test', 'Pia')),   -- public, with links
  ('ben', tests.member('ben@plinks.pgtap.test', 'Ben')),   -- Ada's accepted follower
  ('cy',  tests.member('cy@plinks.pgtap.test', 'Cy')),     -- asked to follow Ada
  ('dan', tests.member('dan@plinks.pgtap.test', 'Dan')),   -- a stranger
  ('eve', tests.member('eve@plinks.pgtap.test', 'Eve')),   -- Pia blocks her
  ('fen', tests.member('fen@plinks.pgtap.test', 'Fen')),   -- blocks Pia
  ('gil', tests.member('gil@plinks.pgtap.test', 'Gil')),   -- follows Pia
  ('hal', tests.member('hal@plinks.pgtap.test', 'Hal'));   -- the owner

select tests.name_owner((select id from ids where name = 'hal'));

-- The social side: Ada private (the default) with Ben following and Cy asking; Pia public.
select tests.act_as((select id from ids where name = 'pia'));
select public.set_private(false);
select tests.act_as((select id from ids where name = 'ada'));
create temporary table ada_link on commit drop as select public.my_social() ->> 'link' as link;
grant select on ada_link to authenticated;
select tests.act_as((select id from ids where name = 'ben'));
select public.follow_target((select link from ada_link));
select public.follow((select id from ids where name = 'ada'));
select tests.act_as((select id from ids where name = 'cy'));
select public.follow_target((select link from ada_link));
select public.follow((select id from ids where name = 'ada'));
select tests.act_as((select id from ids where name = 'ada'));
select public.answer_request((select id from ids where name = 'ben'), true);
select tests.act_as((select id from ids where name = 'gil'));
select public.follow((select id from ids where name = 'pia'));
select tests.act_as((select id from ids where name = 'eve'));
select public.follow((select id from ids where name = 'pia'));
select tests.act_as((select id from ids where name = 'fen'));
select public.follow((select id from ids where name = 'pia'));

-- ------------------------------------------------------------------ the shape of the thing

select is(
  (select array_agg(e::text order by e) from unnest(enum_range(null::public.link_platform)) e),
  array['goodreads', 'reado', 'youtube', 'instagram', 'tiktok'],
  'five platforms, exactly the owner''s list');
select ok(has_table_privilege('authenticated', 'public.profile_links', 'select')
          and not has_table_privilege('authenticated', 'public.profile_links', 'insert')
          and not has_table_privilege('authenticated', 'public.profile_links', 'update')
          and not has_table_privilege('authenticated', 'public.profile_links', 'delete'),
          'a member may read her rows and write none directly');
select ok(not has_table_privilege('anon', 'public.profile_links', 'select')
          and not has_table_privilege('anon', 'public.profile_link_settings', 'select'),
          'anon reads neither table');
select ok(not has_function_privilege('anon', 'public.set_profile_links(jsonb, text)', 'execute')
          and not has_function_privilege('anon', 'public.profile_links_of(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.my_profile_links()', 'execute')
          and not has_function_privilege('anon', 'public.owner_clear_profile_links(uuid)', 'execute'),
          'anon may call none of the functions');
select ok((select bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('set_profile_links', 'profile_links_of', 'my_profile_links', 'owner_clear_profile_links')),
          'the functions are security definer and pin their search_path');

-- ------------------------------------------------------------------ a call with nobody or nothing sensible

select tests.act_anon();
select throws_ok($$select public.set_profile_links('[]'::jsonb)$$, '42501', null, 'signed out: set is refused');
select throws_ok($$select public.profile_links_of(gen_random_uuid())$$, '42501', null, 'signed out: read is refused');

select tests.act_as((select id from ids where name = 'dan'));
select throws_ok($$select public.set_profile_links(null)$$, '22023', 'links_invalid', 'null is not a list');
select throws_ok($$select public.set_profile_links('{"platform":"instagram"}'::jsonb)$$, '22023', 'links_invalid', 'an object is not a list');
select throws_ok($$select public.set_profile_links('["instagram"]'::jsonb)$$, '22023', 'links_invalid', 'an item that is no object is refused');
select throws_ok($$select public.set_profile_links('[{"platform":"instagram"}]'::jsonb)$$, '22023', 'links_invalid', 'an item without a handle is refused');
select throws_ok($$select public.set_profile_links('[{"platform":"instagram","handle":7}]'::jsonb)$$, '22023', 'links_invalid', 'a handle that is no string is refused');
select throws_ok($$select public.set_profile_links('[{"platform":"myspace","handle":"tom"}]'::jsonb)$$, '22023', 'links_invalid', 'a platform that is not on the list is refused');
select throws_ok($$select public.set_profile_links('[{"platform":"instagram","handle":"a"},{"platform":"instagram","handle":"b"}]'::jsonb)$$,
  '22023', 'links_invalid', 'one platform twice is refused');
select throws_ok(
  $$select public.set_profile_links('[{"platform":"instagram","handle":"a"},{"platform":"tiktok","handle":"bb"},{"platform":"youtube","handle":"@ccc"},
     {"platform":"goodreads","handle":"1"},{"platform":"reado","handle":"ee"},{"platform":"reado","handle":"ff"}]'::jsonb)$$,
  '22023', 'links_invalid', 'a sixth link is refused: five platforms, five links at most');
select throws_ok($$select public.set_profile_links('[]'::jsonb, 'friends')$$, '22023', 'visibility_invalid', 'an unknown visibility is refused');
select is(tests.held((select id from ids where name = 'dan')), 0::bigint, 'none of those left a row');
select is(tests.calls_held((select id from ids where name = 'dan')), 0::bigint, 'and a refused call is not counted against the hourly limit');

-- ------------------------------------------------------------------ what each platform accepts

-- Accepted, as typed -> as stored.
select tests.act_as((select id from ids where name = 'dan'));
select is(public.set_profile_links(tests.one('instagram', '@Jane.Doe_01')) -> 'links', tests.one('instagram', 'jane.doe_01'),
  'Instagram: an @ is stripped and the handle lower-cased');
select is(public.set_profile_links(tests.one('instagram', '  a  ')) -> 'links', tests.one('instagram', 'a'), 'Instagram: one character is a handle, spaces around it go');
select is(public.set_profile_links(tests.one('instagram', repeat('a', 30))) -> 'links', tests.one('instagram', repeat('a', 30)), 'Instagram: 30 characters');
select is(public.set_profile_links(tests.one('tiktok', '@Some_One')) -> 'links', tests.one('tiktok', 'some_one'), 'TikTok: an @ is stripped and the handle lower-cased');
select is(public.set_profile_links(tests.one('tiktok', repeat('b', 24))) -> 'links', tests.one('tiktok', repeat('b', 24)), 'TikTok: 24 characters');
select tests.forget_calls((select id from ids where name = 'dan'));
select is(public.set_profile_links(tests.one('youtube', 'MyChannel')) -> 'links', tests.one('youtube', '@mychannel'), 'YouTube: a handle gets its @ and its case folded');
select is(public.set_profile_links(tests.one('youtube', '@My-Channel.x')) -> 'links', tests.one('youtube', '@my-channel.x'), 'YouTube: hyphen and dot are fine inside');
select is(public.set_profile_links(tests.one('youtube', 'UCabcdefghijklmnopqrstuV')) -> 'links', tests.one('youtube', 'UCabcdefghijklmnopqrstuV'),
  'YouTube: a channel id keeps its case and has no @');
select is(public.set_profile_links(tests.one('goodreads', '12345')) -> 'links', tests.one('goodreads', '12345'), 'Goodreads: a number');
select is(public.set_profile_links(tests.one('goodreads', '123456789012')) -> 'links', tests.one('goodreads', '123456789012'), 'Goodreads: 12 digits');
select is(public.set_profile_links(tests.one('reado', '@Karla_')) -> 'links', tests.one('reado', 'Karla_'), 'Reado: an @ is stripped, the case stays');

select tests.forget_calls((select id from ids where name = 'dan'));

-- Refused. Every one names its platform.
select throws_ok($$select public.set_profile_links(tests.one('instagram', 'https://www.instagram.com/jane/'))$$, '22023', 'link_invalid:instagram', 'Instagram: a URL is refused');
select throws_ok($$select public.set_profile_links(tests.one('instagram', 'jane doe'))$$, '22023', 'link_invalid:instagram', 'Instagram: a space is refused');
select throws_ok($$select public.set_profile_links(tests.one('instagram', 'jane/'))$$, '22023', 'link_invalid:instagram', 'Instagram: a slash is refused');
select throws_ok($$select public.set_profile_links(tests.one('instagram', 'jane?x=1'))$$, '22023', 'link_invalid:instagram', 'Instagram: a query is refused');
select throws_ok($$select public.set_profile_links(tests.one('instagram', repeat('a', 31)))$$, '22023', 'link_invalid:instagram', 'Instagram: 31 characters are too long');
select throws_ok($$select public.set_profile_links(tests.one('instagram', '.jane'))$$, '22023', 'link_invalid:instagram', 'Instagram: no leading dot');
select throws_ok($$select public.set_profile_links(tests.one('instagram', 'jane.'))$$, '22023', 'link_invalid:instagram', 'Instagram: no trailing dot');
select throws_ok($$select public.set_profile_links(tests.one('instagram', 'ja..ne'))$$, '22023', 'link_invalid:instagram', 'Instagram: no doubled dot');
select throws_ok($$select public.set_profile_links(tests.one('instagram', ''))$$, '22023', 'link_invalid:instagram', 'Instagram: nothing is no handle (a field she empties is left out of the list)');
select throws_ok($$select public.set_profile_links(tests.one('instagram', E'jane\f'))$$, '22023', 'link_invalid:instagram', 'other whitespace after the handle (a form feed) is not trimmed away');
select throws_ok($$select public.set_profile_links(tests.one('instagram', E'jane\nx'))$$, '22023', 'link_invalid:instagram', 'a newline inside is refused');
select throws_ok($$select public.set_profile_links(tests.one('instagram', 'jаne'))$$, '22023', 'link_invalid:instagram', 'a Cyrillic а is refused, not folded into a letter');
select throws_ok($$select public.set_profile_links(tests.one('instagram', 'jane' || chr(8203)))$$, '22023', 'link_invalid:instagram', 'a zero-width space is refused');
select throws_ok($$select public.set_profile_links(tests.one('instagram', 'ｊane'))$$, '22023', 'link_invalid:instagram', 'a full-width letter is refused');
select throws_ok($$select public.set_profile_links(tests.one('instagram', 'jane' || chr(8238) || 'x'))$$, '22023', 'link_invalid:instagram', 'a right-to-left override is refused');
select throws_ok($$select public.set_profile_links(tests.one('instagram', 'javascript:alert(1)'))$$, '22023', 'link_invalid:instagram', 'javascript: is refused');
select throws_ok($$select public.set_profile_links(tests.one('tiktok', 'a'))$$, '22023', 'link_invalid:tiktok', 'TikTok: one character is too short');
select throws_ok($$select public.set_profile_links(tests.one('tiktok', repeat('b', 25)))$$, '22023', 'link_invalid:tiktok', 'TikTok: 25 characters are too long');
select throws_ok($$select public.set_profile_links(tests.one('tiktok', 'some.one.'))$$, '22023', 'link_invalid:tiktok', 'TikTok: no trailing dot');
select throws_ok($$select public.set_profile_links(tests.one('tiktok', '@@some'))$$, '22023', 'link_invalid:tiktok', 'TikTok: one @ is stripped, not two');
select throws_ok($$select public.set_profile_links(tests.one('tiktok', 'https://www.tiktok.com/@some'))$$, '22023', 'link_invalid:tiktok', 'TikTok: a URL is refused');
select throws_ok($$select public.set_profile_links(tests.one('youtube', 'ab'))$$, '22023', 'link_invalid:youtube', 'YouTube: two characters are too short for a handle');
select throws_ok($$select public.set_profile_links(tests.one('youtube', repeat('c', 31)))$$, '22023', 'link_invalid:youtube', 'YouTube: 31 characters are too long for a handle');
select throws_ok($$select public.set_profile_links(tests.one('youtube', 'https://youtube.com/@x'))$$, '22023', 'link_invalid:youtube', 'YouTube: a URL is refused');
select throws_ok($$select public.set_profile_links(tests.one('youtube', 'my channel'))$$, '22023', 'link_invalid:youtube', 'YouTube: a space is refused');
select throws_ok($$select public.set_profile_links(tests.one('goodreads', '12ab'))$$, '22023', 'link_invalid:goodreads', 'Goodreads: letters are refused');
select throws_ok($$select public.set_profile_links(tests.one('goodreads', '1234567890123'))$$, '22023', 'link_invalid:goodreads', 'Goodreads: 13 digits are too many');
select throws_ok($$select public.set_profile_links(tests.one('goodreads', '12345-jane'))$$, '22023', 'link_invalid:goodreads', 'Goodreads: the server takes the number only, not the slug');
select throws_ok($$select public.set_profile_links(tests.one('goodreads', '٣٣٣'))$$, '22023', 'link_invalid:goodreads', 'Goodreads: Arabic-Indic digits are refused');
select throws_ok($$select public.set_profile_links(tests.one('goodreads', '0123'))$$, '22023', 'link_invalid:goodreads', 'Goodreads: no leading zero');
select throws_ok($$select public.set_profile_links(tests.one('reado', 'x'))$$, '22023', 'link_invalid:reado', 'Reado: one character is too short');
select throws_ok($$select public.set_profile_links(tests.one('reado', 'a b'))$$, '22023', 'link_invalid:reado', 'Reado: a space is refused');
select throws_ok($$select public.set_profile_links(tests.one('reado', 'https://reado.app/en/profile/karla'))$$, '22023', 'link_invalid:reado', 'Reado: a URL is refused');
select throws_ok($$select public.set_profile_links(tests.one('instagram', 'ok') || tests.one('tiktok', 'x'))$$, '22023', 'link_invalid:tiktok',
  'one bad item refuses the whole call');
select is(public.my_profile_links() -> 'links', tests.one('reado', 'Karla_'), 'and the list she had is as it was');

-- The table is a second wall: past the function, uppercase Instagram and a URL are no rows either.
reset role;
select throws_ok(
  format($$insert into public.profile_links (member_id, platform, handle) values (%L, 'instagram', 'Jane')$$, (select id from ids where name = 'eve')),
  '23514', null, 'the table refuses an Instagram handle that is not canonical');
select throws_ok(
  format($$insert into public.profile_links (member_id, platform, handle) values (%L, 'goodreads', 'https://goodreads.com/user/show/1')$$, (select id from ids where name = 'eve')),
  '23514', null, 'and a URL');
select tests.act_as((select id from ids where name = 'eve'));
select throws_ok(
  format($$insert into public.profile_links (member_id, platform, handle) values (%L, 'instagram', 'jane')$$, (select id from ids where name = 'eve')),
  '42501', null, 'a member cannot write a row herself');

-- ------------------------------------------------------------------ the list is replaced, the setting kept

select tests.act_as((select id from ids where name = 'ada'));
select is(public.my_profile_links(), jsonb_build_object('links', '[]'::jsonb, 'visibility', 'followers'), 'no links, and followers only by default');
select is(tests.settings_held((select id from ids where name = 'ada')), 0::bigint, 'the default needs no row');
select is(
  public.set_profile_links('[{"platform":"instagram","handle":"@Ada.Reads"},{"platform":"goodreads","handle":"4242"}]'::jsonb) -> 'links',
  '[{"platform":"goodreads","handle":"4242"},{"platform":"instagram","handle":"ada.reads"}]'::jsonb,
  'two links are stored, in the platforms'' order');
select is(public.my_profile_links() ->> 'visibility', 'followers', 'a call without a visibility keeps the default');
select is(public.set_profile_links(tests.one('instagram', 'ada.reads')) -> 'links', tests.one('instagram', 'ada.reads'),
  'a platform she leaves out is removed');
select is(public.set_profile_links('[]'::jsonb) -> 'links', '[]'::jsonb, 'an empty list clears them');
select is(tests.held((select id from ids where name = 'ada')), 0::bigint, 'nothing is left');

-- ------------------------------------------------------------------ the hourly limit

select tests.forget_calls((select id from ids where name = 'ada'));
select lives_ok($$select public.set_profile_links(tests.one('instagram', 'ada' || g)) from generate_series(1, 10) g$$, 'ten calls an hour are fine');
select throws_ok($$select public.set_profile_links(tests.one('instagram', 'ada'))$$, 'PT429', 'rate_limited', 'the eleventh is refused');
select is(public.my_profile_links() -> 'links', tests.one('instagram', 'ada10'), 'and changed nothing');
select tests.forget_calls((select id from ids where name = 'ada'));

-- ------------------------------------------------------------------ who sees what

-- Ada: Instagram and Goodreads, followers only (the default). Pia: TikTok, followers only too.
select public.set_profile_links('[{"platform":"instagram","handle":"ada.reads"},{"platform":"goodreads","handle":"4242"}]'::jsonb);
select tests.act_as((select id from ids where name = 'pia'));
select public.set_profile_links(tests.one('tiktok', 'pia_reads'));
select tests.forget_calls((select id from ids where name = 'pia'));

-- Followers only, Ada (private).
select tests.act_as((select id from ids where name = 'ada'));
select is(jsonb_array_length(public.profile_links_of((select id from ids where name = 'ada'))), 2, 'herself: both, whatever her setting');
select tests.act_as((select id from ids where name = 'ben'));
select ok(tests.has(public.profile_links_of((select id from ids where name = 'ada')), 'instagram', 'ada.reads')
          and tests.has(public.profile_links_of((select id from ids where name = 'ada')), 'goodreads', '4242'),
          'followers only: an accepted follower sees them');
select tests.act_as((select id from ids where name = 'cy'));
select is(public.profile_links_of((select id from ids where name = 'ada')), '[]'::jsonb, 'followers only: a requester sees none');
select tests.act_as((select id from ids where name = 'dan'));
select is(public.profile_links_of((select id from ids where name = 'ada')), '[]'::jsonb, 'followers only: a stranger sees none');
select is(public.profile_links_of(gen_random_uuid()), '[]'::jsonb, 'nobody there is an empty list too, not a refusal');
select tests.act_as((select id from ids where name = 'ben'));
select is(public.profile_links_of(null), '[]'::jsonb, 'so is no member at all');

-- Followers only, Pia (public): one who only reads her page does not see them, a follower does.
select tests.act_as((select id from ids where name = 'dan'));
select is(public.profile_links_of((select id from ids where name = 'pia')), '[]'::jsonb, 'followers only on a public account: a non-follower sees none');
select tests.act_as((select id from ids where name = 'gil'));
select ok(tests.has(public.profile_links_of((select id from ids where name = 'pia')), 'tiktok', 'pia_reads'), 'followers only on a public account: a follower sees them');

-- Everyone, Ada: whoever may see her profile, so her followers and nobody who waits or knows nothing.
select tests.act_as((select id from ids where name = 'ada'));
select is(public.set_profile_links(public.my_profile_links() -> 'links', 'everyone') ->> 'visibility', 'everyone', 'she picks everyone');
select tests.act_as((select id from ids where name = 'ben'));
select is(jsonb_array_length(public.profile_links_of((select id from ids where name = 'ada'))), 2, 'everyone: her follower sees them');
select tests.act_as((select id from ids where name = 'cy'));
select is(public.profile_links_of((select id from ids where name = 'ada')), '[]'::jsonb, 'everyone, on a private account: a requester still sees none, as of her reading');
select tests.act_as((select id from ids where name = 'dan'));
select is(public.profile_links_of((select id from ids where name = 'ada')), '[]'::jsonb, 'everyone, on a private account: a stranger sees none');

-- Everyone, Pia (public): whoever can reach her.
select tests.act_as((select id from ids where name = 'pia'));
select public.set_profile_links(public.my_profile_links() -> 'links', 'everyone');
select tests.act_as((select id from ids where name = 'dan'));
select ok(tests.has(public.profile_links_of((select id from ids where name = 'pia')), 'tiktok', 'pia_reads'), 'everyone, on a public account: a member who does not follow her sees them');

-- Only me.
select tests.act_as((select id from ids where name = 'ada'));
select public.set_profile_links(public.my_profile_links() -> 'links', 'me');
select tests.act_as((select id from ids where name = 'ben'));
select is(public.profile_links_of((select id from ids where name = 'ada')), '[]'::jsonb, 'only me: even her follower sees none');
select tests.act_as((select id from ids where name = 'ada'));
select is(jsonb_array_length(public.profile_links_of((select id from ids where name = 'ada'))), 2, 'only me: she sees her own');
select tests.act_as((select id from ids where name = 'pia'));
select public.set_profile_links(public.my_profile_links() -> 'links', 'me');
select tests.act_as((select id from ids where name = 'gil'));
select is(public.profile_links_of((select id from ids where name = 'pia')), '[]'::jsonb, 'only me, on a public account: her follower sees none');

-- Blocks, both ways, with her links at their widest.
select tests.act_as((select id from ids where name = 'pia'));
select public.set_profile_links(public.my_profile_links() -> 'links', 'everyone');
select public.block((select id from ids where name = 'eve'));
select tests.act_as((select id from ids where name = 'eve'));
select is(public.profile_links_of((select id from ids where name = 'pia')), '[]'::jsonb, 'she blocked me: I see none, though she shows everyone');
select tests.act_as((select id from ids where name = 'fen'));
select ok(tests.has(public.profile_links_of((select id from ids where name = 'pia')), 'tiktok', 'pia_reads'), 'before the block, Fen sees them');
select public.block((select id from ids where name = 'pia'));
select is(public.profile_links_of((select id from ids where name = 'pia')), '[]'::jsonb, 'I blocked her: I see none either');
select tests.act_as((select id from ids where name = 'gil'));
select ok(tests.has(public.profile_links_of((select id from ids where name = 'pia')), 'tiktok', 'pia_reads'), 'and a member who blocked nobody still does');

-- RLS: her own rows only.
select tests.act_as((select id from ids where name = 'dan'));
select is((select count(*) from public.profile_links where member_id = (select id from ids where name = 'pia')), 0::bigint, 'no member reads another''s rows directly');
select is((select count(*) from public.profile_link_settings where member_id = (select id from ids where name = 'pia')), 0::bigint, 'nor her setting');
select tests.act_as((select id from ids where name = 'pia'));
select is((select count(*) from public.profile_links where member_id = (select id from ids where name = 'pia')), 1::bigint, 'she reads her own');

-- ------------------------------------------------------------------ the owner's action

select tests.act_as((select id from ids where name = 'ben'));
select throws_ok(format($$select public.owner_clear_profile_links(%L)$$, (select id from ids where name = 'pia')), '42501', 'not_owner', 'a member is not the owner');
select tests.act_as((select id from ids where name = 'pia'));
select throws_ok(format($$select public.owner_clear_profile_links(%L)$$, (select id from ids where name = 'pia')), '42501', 'not_owner', 'not even for her own links');
select tests.act_as((select id from ids where name = 'hal'));
select is(public.owner_clear_profile_links((select id from ids where name = 'pia')), 1, 'the owner clears them, and is told how many');
select is(tests.held((select id from ids where name = 'pia')), 0::bigint, 'they are gone');
select is(tests.settings_held((select id from ids where name = 'pia')), 1::bigint, 'her setting stays');

-- ------------------------------------------------------------------ deleted with the account

reset role;
select is(tests.held((select id from ids where name = 'ada')), 2::bigint, 'Ada has two links before she leaves');
delete from auth.users where id = (select id from ids where name = 'ada');
select is(tests.held((select id from ids where name = 'ada')), 0::bigint, 'her links go with her account');
select is(tests.settings_held((select id from ids where name = 'ada')), 0::bigint, 'and her setting');
select is(tests.calls_held((select id from ids where name = 'ada')), 0::bigint, 'and the log of her calls');

select * from finish();
rollback;
