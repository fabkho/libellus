-- Hardcover's covers (20261112010000_hardcover_covers.sql; docs/plans/hardcover-zip.md, "Covers from Hardcover"):
--   supabase test db
--
--   * `private.cover_allowed` takes the one host `assets.hardcover.app` and nothing that merely contains it
--   * `private.cover_shown` (what a reading page, `/r/` and the social answers may draw) is FALSE for that host (owner
--     decision, 31 Oct 2026), and still true for the others
--   * the Book JSON of those answers carries neither the address nor the stored copy's key for such a Book
--   * a Book of hers without a cover can be given a Hardcover one (`fill_book_covers`), and the job's row can be saved with
--     the `hardcover` cover, counted in `cover_hardcover`

begin;
select plan(23);
set local client_min_messages = warning;

create schema if not exists tests;
insert into public.invite_codes (code, label, max_uses) values ('T-HC-COVER', 'hardcover cover test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-HC-COVER"}'::jsonb, now(), now(), now());
  return v_id;
end;
$$;
create or replace function tests.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
grant usage on schema tests to authenticated, service_role;
grant execute on all functions in schema tests to authenticated, service_role;

-- ------------------------------------------------------------------ the allow-list

select is(private.cover_allowed('https://assets.hardcover.app/edition/1234/abc.jpeg'), true, 'a Hardcover cover is allowed');
select is(private.cover_allowed('https://assets.hardcover.app'), true, 'the bare host is the host');
select is(private.cover_allowed('http://assets.hardcover.app/edition/1/a.jpg'), false, 'http is not');
select is(private.cover_allowed('https://assets.hardcover.app.evil.example/a.jpg'), false, 'host.evil is not');
select is(private.cover_allowed('https://assets.hardcover.app@evil.example/a.jpg'), false, 'host@evil is not');
select is(private.cover_allowed('https://assets.hardcover.app:80@evil.example/a.jpg'), false, 'host:80@evil is not');
select is(private.cover_allowed('https://evil.example/#@assets.hardcover.app/'), false, 'host in a fragment is not');
select is(private.cover_allowed('https://cdn.hardcover.app/a.jpg'), false, 'another Hardcover host is not');
select is(private.cover_allowed('https://hardcover.app/a.jpg'), false, 'the site itself is not');
select is(private.cover_allowed('https://i.gr-assets.com/images/x.jpg'), true, 'the earlier hosts still are');

-- ------------------------------------------------------------------ what others may see

select tests.member('ada@hc-cover.pgtap.test') as ada \gset
select tests.member('ben@hc-cover.pgtap.test') as ben \gset

insert into public.books (title, authors, source, isbn13, cover_url, cover_key, cover_widths)
values ('Pgtap Hardcover Cover', array['An Author'], 'import', '9780000200010',
        'https://assets.hardcover.app/edition/1234/abc.jpeg', '00000000000000000000000000000001', '{600}')
returning id as hc_book \gset
insert into public.books (title, authors, source, isbn13, cover_url, cover_key, cover_widths)
values ('Pgtap Goodreads Cover', array['An Author'], 'import', '9780000200027',
        'https://i.gr-assets.com/images/x.jpg', '00000000000000000000000000000002', '{600}')
returning id as gr_book \gset

select is((select private.cover_shown(b) from public.books b where b.id = :'hc_book'), false, 'cover_shown: not for a Hardcover cover');
select is((select private.cover_shown(b) from public.books b where b.id = :'gr_book'), true, 'cover_shown: still for another allowed host');
select is((select private.reading_page_book_json(b) ->> 'cover_url' from public.books b where b.id = :'hc_book'), null,
  'the Book JSON of the social answers carries no Hardcover address …');
select is((select private.reading_page_book_json(b) ->> 'cover_key' from public.books b where b.id = :'hc_book'), null,
  '… and not the key of its stored copy …');
select is((select private.reading_page_book_json(b) ->> 'cover_widths' from public.books b where b.id = :'hc_book'), null,
  '… nor its widths');
select is((select private.reading_page_book_json(b) ->> 'cover_key' from public.books b where b.id = :'gr_book'), '00000000000000000000000000000002',
  'another allowed host keeps its key');

-- A Book of hers without a cover is given a Hardcover one (the import job's fill); her own Library reads it.
insert into public.books (title, authors, source, isbn13) values ('Pgtap Bare', array['An Author'], 'import', '9780000200034') returning id as bare \gset
insert into public.library_entries (member_id, book_id) values (:'ada', :'bare');
select tests.act_as(:'ada');
select is(public.fill_book_covers(jsonb_build_array(jsonb_build_object('book_id', :'bare', 'cover_url', 'https://assets.hardcover.app/edition/77/def.jpg'))),
  1, 'fill_book_covers takes a Hardcover cover');
select is((select cover_url from public.books where id = :'bare'), 'https://assets.hardcover.app/edition/77/def.jpg', 'her Library reads it (inside the app it shows)');
reset role;

-- The cover store takes it (`cover_store_reconcile` asks `cover_allowed`): the one image, queued by its address.
select ok(private.cover_store_reconcile() >= 1, 'the reconcile queues the Book that holds a Hardcover cover');
select is((select source_url from private.cover_store_queue where book_id = :'bare'), 'https://assets.hardcover.app/edition/77/def.jpg', 'by the address');

-- ------------------------------------------------------------------ the job

select tests.act_as(:'ben');
select public.start_import_job(jsonb_build_array(
  jsonb_build_object('key', 'hardcover:1', 'title', 'Pgtap A', 'authors', jsonb_build_array('An Author')),
  jsonb_build_object('key', 'hardcover:2', 'title', 'Pgtap B', 'authors', jsonb_build_array('An Author'))), 'hardcover') as job \gset
reset role;
set local role service_role;
select public.import_job_claim('r1');
select public.import_job_take_rows(:'job', 'r1', 2);
select is(public.import_job_save_row(:'job', 'r1', 0, '{"verdict": "matched", "tier": "quiet", "cover": "hardcover", "cover_url": "https://assets.hardcover.app/edition/9/x.jpg"}'),
  true, 'a row matched with a Hardcover cover is saved');
select public.import_job_save_row(:'job', 'r1', 1, '{"verdict": "matched", "tier": "quiet", "cover": "own", "cover_url": "https://covers.openlibrary.org/b/id/1-L.jpg", "cover_size": "L"}');
reset role;
select is((select concat_ws(',', cover_state, cover_source, cover_url) from public.import_job_rows where job_id = :'job' and idx = 0),
  'done,hardcover,https://assets.hardcover.app/edition/9/x.jpg', 'it is decided with the match, address kept');
select is((select concat_ws(',', cover_edition, cover_lent, cover_hardcover, cover_openlibrary, cover_goodreads, cover_none) from public.import_jobs where id = :'job'),
  '1,0,1,0,0,0', 'and counted on its own: one edition cover, one Hardcover cover');

select * from finish();
rollback;
