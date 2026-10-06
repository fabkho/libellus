-- A member's own Book links (issue #116):
--   supabase test db
--
-- `set_link_templates(list)` stores the calling member's whole list in her order,
-- trimmed, and replaces what was there; an empty list clears it. Only she reads
-- her row: another member sees nothing of it, and nobody writes the table
-- directly. A list of the wrong shape (not an array, too long, missing or extra
-- keys, an empty or long label, a URL that is not http(s) or puts a placeholder
-- in the host) is refused as link_templates_invalid; a signed-out caller as
-- not_signed_in. Deleting the member deletes her row. Assertions ask about the
-- rows this test made, never about how many rows a table holds.

begin;
select plan(21);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-LINKS', 'link templates test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-LINKS"}'::jsonb, now(), now(), now());
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

-- Her row, past RLS.
create or replace function tests.templates_of(p_member uuid)
returns jsonb language sql security definer as $$
  select templates from public.link_templates where member_id = p_member
$$;

create temporary table ids (name text primary key, id uuid) on commit drop;
grant select on ids to authenticated;
insert into ids values
  ('ada',  tests.member('ada@links.pgtap.test')),
  ('ben',  tests.member('ben@links.pgtap.test'));

-- ------------------------------------------------------------- her own list

select tests.act_as((select id from ids where name = 'ada'));

select is(
  (select templates from public.set_link_templates(
     '[{"label":"  Open Library ","url":" https://openlibrary.org/isbn/{isbn} "},
       {"label":"City library","url":"https://catalogue.example.org/search?q={title}%20{author}"}]'::jsonb)),
  '[{"label":"Open Library","url":"https://openlibrary.org/isbn/{isbn}"},
    {"label":"City library","url":"https://catalogue.example.org/search?q={title}%20{author}"}]'::jsonb,
  'she saves her list: in her order, labels and URLs trimmed');

select is(
  (select templates from public.link_templates),
  '[{"label":"Open Library","url":"https://openlibrary.org/isbn/{isbn}"},
    {"label":"City library","url":"https://catalogue.example.org/search?q={title}%20{author}"}]'::jsonb,
  'and reads it back');

select is(
  (select templates -> 0 ->> 'label' from public.set_link_templates(
     '[{"label":"City library","url":"https://catalogue.example.org/search?q={title}%20{author}"},
       {"label":"Open Library","url":"https://openlibrary.org/isbn/{isbn}"}]'::jsonb)),
  'City library',
  'saving again replaces the list: a new order is the order');

select is((select count(*)::int from public.link_templates), 1, 'one row per member, however often she saves');

-- -------------------------------------------------------------- hers alone

reset role;
select tests.act_as((select id from ids where name = 'ben'));

select is((select count(*)::int from public.link_templates), 0, 'another member sees none of her links');

select lives_ok(
  $$select public.set_link_templates('[{"label":"Bookshop","url":"http://shop.example.com/isbn/{isbn10}"}]'::jsonb)$$,
  'he saves his own (http is fine too)');

select is(
  (select templates -> 0 ->> 'label' from public.link_templates),
  'Bookshop', 'and sees only his');

select throws_ok(
  $$insert into public.link_templates (member_id, templates) values ((select id from ids where name = 'ada'), '[]')$$,
  '42501', null, 'nobody writes the table directly, not for someone else');

select throws_ok(
  $$update public.link_templates set templates = '[]'$$,
  '42501', null, 'nor changes a row directly');

reset role;
select is(
  tests.templates_of((select id from ids where name = 'ada')) -> 0 ->> 'label',
  'City library', 'her list is as she left it');

-- ------------------------------------------------------------- the shape

reset role;
select tests.act_as((select id from ids where name = 'ada'));

select throws_ok($$select public.set_link_templates('{"label":"x","url":"https://example.org"}'::jsonb)$$,
  '22023', 'link_templates_invalid', 'not a list is refused');
select throws_ok($$select public.set_link_templates('[{"label":"x"}]'::jsonb)$$,
  '22023', 'link_templates_invalid', 'a link without a URL is refused');
select throws_ok($$select public.set_link_templates('[{"label":"x","url":"https://example.org","note":"y"}]'::jsonb)$$,
  '22023', 'link_templates_invalid', 'a key of its own is refused');
select throws_ok($$select public.set_link_templates('[{"label":"   ","url":"https://example.org"}]'::jsonb)$$,
  '22023', 'link_templates_invalid', 'a blank label is refused');
select throws_ok($$select public.set_link_templates(jsonb_build_array(jsonb_build_object('label', repeat('a', 41), 'url', 'https://example.org')))$$,
  '22023', 'link_templates_invalid', 'a label over 40 characters is refused');
select throws_ok($$select public.set_link_templates('[{"label":"x","url":"javascript:alert(1)"}]'::jsonb)$$,
  '22023', 'link_templates_invalid', 'a URL that is not http(s) is refused');
select throws_ok($$select public.set_link_templates('[{"label":"x","url":"https://{title}.example.org/"}]'::jsonb)$$,
  '22023', 'link_templates_invalid', 'a placeholder in the host is refused');
select throws_ok(
  $$select public.set_link_templates((select jsonb_agg(jsonb_build_object('label', 'L' || n, 'url', 'https://example.org/' || n)) from generate_series(1, 21) n))$$,
  '22023', 'link_templates_invalid', 'more than 20 links are refused');

select is(
  (select templates from public.set_link_templates('[]'::jsonb)),
  '[]'::jsonb, 'an empty list clears hers');

-- ------------------------------------------------------- signed out, deleted

reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$select public.set_link_templates('[]'::jsonb)$$,
  '42501', null, 'a signed-out caller cannot save links');

reset role;
delete from auth.users where id = (select id from ids where name = 'ben');
select is(tests.templates_of((select id from ids where name = 'ben')), null, 'a deleted member''s links go with him');

select * from finish();
rollback;
