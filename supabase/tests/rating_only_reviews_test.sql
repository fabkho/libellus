-- A review that is only a rating is a rating (migration 20261025030000_rating_only_reviews.sql):
--   supabase test db
--
-- The text rule (private.rating_from_review_text, mirrored by web/app/utils/ratingReview.ts) in every form, and the
-- one-time fix on reads already there: a finished read takes the number, rounded down to the quarter, over a rating an
-- import wrote (import key; for Goodreads only a whole star), never over one set in the app; the number text is cleared
-- where nothing is lost; a text that is not only a rating is left alone; nothing else changes; a second run changes nothing.

begin;
select plan(45);

create schema if not exists tests;
insert into public.invite_codes (code, label, max_uses) values ('T-RATING-REVIEW', 'rating-only reviews test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
          '{"invite_code":"T-RATING-REVIEW"}'::jsonb, now(), now(), now());
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
-- A finished read (a finish, with its rating and review as given).
create or replace function tests.finished(p_title text, p_rating integer, p_review text)
returns uuid language plpgsql as $$
declare v_entry uuid;
begin
  v_entry := (public.add_to_library(jsonb_build_object('title', p_title, 'authors', jsonb_build_array('An Author'), 'source', 'apple',
              'apple_id', (9600000000 + floor(random() * 99999999))::bigint::text), 'reading', current_date - 3)).id;
  perform public.finish_reading(v_entry, current_date, p_rating, p_review);
  return v_entry;
end;
$$;
grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

create temporary table reads (name text primary key, entry uuid);
grant all on reads to authenticated;

-- ------------------------------------------------------------------ the rule on a text

select is(
  (select string_agg(coalesce(private.rating_from_review_text(t)::text, '-'), ' ' order by n)
     from (values
       (1, '4.6'), (2, '4,6'), (3, '5/5'), (4, '4.5/5'), (5, '4.6/10'), (6, '3'), (7, '4.9'), (8, '4.75'), (9, '4.74'),
       (10, '8/10'), (11, '10/10'), (12, '7.5/10'), (13, '4.5 ★'), (14, '4 stars'), (15, '4.5 STARS'), (16, '  4 / 5 '), (17, '0.25')
     ) v(n, t)),
  '18 18 20 18 18 12 19 19 18 16 20 15 18 16 18 16 1',
  'every form is its rating, rounded down to the quarter (4.6 is 18, 4.9 is 19, 5 is 20, 3 is 12, /10 typos and halves)');
select is(
  (select string_agg(coalesce(private.rating_from_review_text(t)::text, '-'), ' ' order by n)
     from (values
       (1, '5 stars, loved it'), (2, 'Book 2 of 3'), (3, '1984'), (4, '7'), (5, '6/5'), (6, '11/10'), (7, '4.5/6'),
       (8, '4.5/5 loved it'), (9, ''), (10, '4..5'), (11, '-4'), (12, '4 out of 5'), (13, '0'), (14, '0.24')
     ) v(n, t)),
  '- - - - - - - - - - - - - -',
  'a text that is not only a rating says none (a number above 5 with no /10, words, 0)');
select is(private.rating_from_review_text(null), null, 'no text says none');
select is(private.rating_text_stars('0'), 0::numeric, '0 is a rating-only text (unrated)');
select is(private.rating_text_stars('1984'), null, 'and 1984 is not');

-- ------------------------------------------------------------------ the fix on reads

create temporary table owners (name text primary key, id uuid);
grant all on owners to authenticated;
insert into owners values ('ada', tests.member('ada@rating-review.pgtap.test'));
select tests.act_as((select id from owners where name = 'ada'));

-- Reads made in the app (no import key) and reads an import wrote (import key set below).
insert into reads (name, entry)
select x.n, tests.finished('Read ' || x.n, x.r, x.t)
  from (values
    ('gr_whole',   16,           '4.3'),
    ('gr_five',    20,           '4.6'),
    ('gr_same',    20,           '5/5'),
    ('gr_quarter', 17,           '4.6'),
    ('gr_null',    null::integer, '4.5/5'),
    ('gr_zero',    12,           '0'),
    ('hc_half',    14,           '4.6'),
    ('hc_whole',   16,           '4.6'),
    ('app_edit',   12,           '4.6'),
    ('long',       null,         '4.5'),
    ('app_null',   null,         '4.6'),
    ('app_kept',   16,           '4.3'),
    ('app_equal',  18,           '4.6'),
    ('words',      null,         '5 stars, loved it'),
    ('series',     null,         'Book 2 of 3'),
    ('year',       null,         '1984'),
    ('review',     14,           'Lovely.'),
    ('none',       null,         null),
    ('aband',      null,         null)
  ) x(n, r, t);
-- An open read, and an abandoned one whose review is a number (it has no rating to give it to).
insert into reads select 'open', (public.add_to_library(jsonb_build_object('title', 'Open read', 'authors', jsonb_build_array('A'), 'source', 'apple',
  'apple_id', (9600000000 + floor(random() * 99999999))::bigint::text), 'reading', current_date - 1)).id;
reset role;

-- The abandoned read: finished above only to make the entry; make it abandoned with a number as its text.
update public.reading_sessions set outcome = 'abandoned', rating = null, review = '4.6'
 where entry_id = (select entry from reads where name = 'aband');
-- What an import wrote carries its key.
update public.reading_sessions s set import_key = k.key
  from reads r, (values ('gr_whole', 'goodreads:1'), ('gr_five', 'goodreads:2'), ('gr_same', 'goodreads:3'), ('gr_quarter', 'goodreads:4'),
                        ('gr_null', 'goodreads:5'), ('gr_zero', 'goodreads:6'), ('hc_half', 'hardcover:7'), ('hc_whole', 'hardcover:8'),
                        ('app_edit', 'goodreads:9')) k(n, key)
 where r.entry = s.entry_id and r.name = k.n;
-- A text with room around it, longer than 40 characters (a finish trims, so it is written past the API).
update public.reading_sessions s set review = '4.5' || repeat(' ', 50) from reads r where r.entry = s.entry_id and r.name = 'long';
-- Spoiler flags: on a read whose text is cleared (must go false) and on one whose text stays (stays true).
update public.reading_sessions s set review_spoilers = true
  from reads r where r.entry = s.entry_id and r.name in ('gr_whole', 'app_kept', 'hc_half');

create temporary table before as
  select s.id, md5(concat_ws('|', s.entry_id, s.outcome, s.started_on, s.ended_on, s.abandon_reason, s.import_key)) as other
    from public.reading_sessions s join reads r on r.entry = s.entry_id;

create or replace function tests.rating(p_name text)
returns integer language sql as $$
  select s.rating from public.reading_sessions s join reads r on r.entry = s.entry_id where r.name = p_name
$$;
create or replace function tests.review(p_name text)
returns text language sql as $$
  select s.review from public.reading_sessions s join reads r on r.entry = s.entry_id where r.name = p_name
$$;

select cmp_ok(private.rating_only_reviews_fix(), '>=', 9, 'the fix changes at least the nine reads that carry a rating-only review it can use');

select is(tests.rating('gr_whole'), 17, 'an imported whole-star rating (4) gives way to the number: "4.3" is 17');
select is(tests.rating('gr_five'), 18, 'an imported 5 stars gives way to "4.6": 18');
select is(tests.rating('gr_same'), 20, '"5/5" on 5 stars: 20, unchanged');
select is(tests.rating('gr_quarter'), 17, 'a quarter rating on a Goodreads read was set in the app: it stays');
select is(tests.rating('hc_half'), 14, 'a Hardcover half-star rating is not a whole star: it stays (every source, not only Goodreads)');
select is(tests.rating('hc_whole'), 18, 'a Hardcover whole-star rating gives way to the number');
select is(tests.rating('app_edit'), 18, 'ACCEPTED EDGE: a whole star set in the app on an imported read looks like the import''s and gives way (import_key is never cleared on an edit)');
select is(tests.rating('long'), null, 'a text over 40 characters is no rating (as the TypeScript rule)');
select is(tests.rating('gr_null'), 18, 'an imported read with no rating takes "4.5/5": 18');
select is(tests.rating('gr_zero'), 12, '"0" says no rating: the rating stays');
select is(tests.rating('app_null'), 18, 'a read made in the app with no rating takes the number');
select is(tests.rating('app_kept'), 16, 'a rating set in the app (no import key) stays, whatever the text says');
select is(tests.rating('app_equal'), 18, 'and the same number changes nothing');
select is(tests.rating('words'), null, '"5 stars, loved it" is a review: no rating');
select is(tests.rating('series'), null, '"Book 2 of 3" is a review: no rating');
select is(tests.rating('year'), null, '"1984" is a review: no rating');
select is(tests.rating('review'), 14, 'a real review leaves its rating');
select is(tests.rating('open'), null, 'an open read has no rating');
select is(tests.rating('aband'), null, 'an abandoned read has none to give');

select is(
  (select array_agg(n || '=' || coalesce(tests.review(n), '-') order by n)
     from unnest(array['gr_whole', 'gr_five', 'gr_same', 'gr_null', 'gr_zero', 'hc_whole', 'app_edit', 'app_null', 'app_equal']) n),
  array['app_edit=-', 'app_equal=-', 'app_null=-', 'gr_five=-', 'gr_null=-', 'gr_same=-', 'gr_whole=-', 'gr_zero=-', 'hc_whole=-'],
  'the number text is cleared only where the rating is now the number (or the text is "0")');
select is(tests.review('gr_quarter'), '4.6', 'a kept quarter rating that differs from the text keeps the text (nothing is lost)');
select is(tests.review('hc_half'), '4.6', 'and so does a kept Hardcover half star');
select is((select review_spoilers from public.reading_sessions s join reads r on r.entry = s.entry_id where r.name = 'gr_whole'), false,
          'a cleared text takes its spoiler flag with it');
select is((select review_spoilers from public.reading_sessions s join reads r on r.entry = s.entry_id where r.name = 'hc_half'), true,
          'a kept text keeps its spoiler flag');
select is(tests.review('app_kept'), '4.3', 'an app read whose own rating differs keeps the text (nothing is lost)');
select is(tests.review('words'), '5 stars, loved it', 'a real review is kept …');
select is(tests.review('series'), 'Book 2 of 3', '… and so is "Book 2 of 3" …');
select is(tests.review('year'), '1984', '… and "1984"');
select is(tests.review('review'), 'Lovely.', '"Lovely." too');
select is(tests.review('aband'), '4.6', 'an abandoned read keeps its text');
select is(
  (select md5(string_agg(s.id::text || md5(concat_ws('|', s.entry_id, s.outcome, s.started_on, s.ended_on, s.abandon_reason, s.import_key)), ',' order by s.id))
     from public.reading_sessions s join reads r on r.entry = s.entry_id),
  (select md5(string_agg(b.id::text || b.other, ',' order by b.id)) from before b),
  'nothing but the rating and the number text changes');
select is((select count(*)::int from private.rating_only_reviews_backup b join reads r on r.entry = (select entry_id from public.reading_sessions where id = b.id)),
          9, 'the nine changed reads were copied to the backup, and only they');
select is((select b.rating from private.rating_only_reviews_backup b join public.reading_sessions s on s.id = b.id join reads r on r.entry = s.entry_id where r.name = 'gr_whole'), 16::smallint,
          'the backup holds the rating as it was …');
select is((select b.review || '/' || b.review_spoilers::text from private.rating_only_reviews_backup b join public.reading_sessions s on s.id = b.id join reads r on r.entry = s.entry_id where r.name = 'gr_whole'),
          '4.3/true', '… and the text and spoiler flag');
select is((select count(*)::int from private.rating_only_reviews_backup b join public.reading_sessions s on s.id = b.id join reads r on r.entry = s.entry_id where r.name in ('gr_quarter', 'hc_half', 'app_kept', 'words', 'review')), 0,
          'a read the fix leaves as it is is not in the backup');
select is(private.rating_only_reviews_fix(), 0, 'a second run changes nothing');
select is((select count(*)::int from private.rating_only_reviews_backup b join reads r on r.entry = (select entry_id from public.reading_sessions where id = b.id)), 9, 'and copies nothing');
select is(has_table_privilege('authenticated', 'private.rating_only_reviews_backup', 'select'), false, 'the backup has no grants');
select is(has_function_privilege('authenticated', 'private.rating_only_reviews_fix()', 'execute')
          or has_function_privilege('anon', 'private.rating_from_review_text(text)', 'execute'), false, 'no API role runs the helpers');

select * from finish();
rollback;
