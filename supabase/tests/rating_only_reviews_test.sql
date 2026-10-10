-- A review that is only a rating is a rating (migration 20261021030000_rating_only_reviews.sql):
--   supabase test db
--
-- The text rule (private.rating_from_review_text, mirrored by web/app/utils/ratingReview.ts) in every form, and the
-- one-time fix on reads already there: a finished read with no rating takes the number, rounded down to the quarter;
-- a read with a rating keeps it; a text that is not only a rating is left alone; the review text stays; nothing else
-- changes; a second run changes nothing.

begin;
select plan(23);

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

insert into reads (name, entry)
select x.n, tests.finished('Read ' || x.n, x.r, x.t)
  from (values
    ('plain',   null::integer, '4.6'),
    ('five',    null, '5/5'),
    ('typo',    null, '4.6/10'),
    ('three',   null, '3'),
    ('nearly',  null, '4.9'),
    ('comma',   null, '4,5 ★'),
    ('kept',    16,   '4.3'),
    ('words',   null, '5 stars, loved it'),
    ('series',  null, 'Book 2 of 3'),
    ('year',    null, '1984'),
    ('review',  null, 'Lovely.'),
    ('none',    null, null)
  ) x(n, r, t);

-- An open read with the same text is no rating (only finished reads have one).
insert into reads select 'open', (public.add_to_library(jsonb_build_object('title', 'Open read', 'authors', jsonb_build_array('A'), 'source', 'apple',
  'apple_id', (9600000000 + floor(random() * 99999999))::bigint::text), 'reading', current_date - 1)).id;
reset role;

create temporary table before as
  select s.id, md5(concat_ws('|', s.entry_id, s.review, s.outcome, s.started_on, s.ended_on, s.abandon_reason, s.review_spoilers)) as other
    from public.reading_sessions s join reads r on r.entry = s.entry_id;

create or replace function tests.rating(p_name text)
returns integer language sql as $$
  select s.rating from public.reading_sessions s join reads r on r.entry = s.entry_id where r.name = p_name
$$;
create or replace function tests.review(p_name text)
returns text language sql as $$
  select s.review from public.reading_sessions s join reads r on r.entry = s.entry_id where r.name = p_name
$$;

select cmp_ok(private.rating_only_reviews_fix(), '>=', 6, 'the fix changes at least the six reads with a rating-only review and no rating');

select is(tests.rating('plain'), 18, '"4.6" becomes 4.5 stars (18 quarters)');
select is(tests.rating('five'), 20, '"5/5" becomes 5 stars');
select is(tests.rating('typo'), 18, '"4.6/10", a typo for /5, becomes 18');
select is(tests.rating('three'), 12, '"3" becomes 12');
select is(tests.rating('nearly'), 19, '"4.9" rounds down to 4.75 (19)');
select is(tests.rating('comma'), 18, '"4,5 ★" becomes 18');
select is(tests.rating('kept'), 16, 'a read that has a rating keeps it');
select is(tests.rating('words'), null, '"5 stars, loved it" is a review: no rating');
select is(tests.rating('series'), null, '"Book 2 of 3" is a review: no rating');
select is(tests.rating('year'), null, '"1984" is a review: no rating');
select is(tests.rating('review'), null, 'a real review gets no rating');
select is(tests.rating('none'), null, 'a read with no review gets none');
select is(tests.rating('open'), null, 'an open read has no rating');

select is(
  (select count(*)::int from public.reading_sessions s join reads r on r.entry = s.entry_id where s.review is not null),
  11, 'no review text is cleared (the owner decides when)');
select is(
  (select md5(string_agg(s.id::text || md5(concat_ws('|', s.entry_id, s.review, s.outcome, s.started_on, s.ended_on, s.abandon_reason, s.review_spoilers)), ',' order by s.id))
     from public.reading_sessions s join reads r on r.entry = s.entry_id),
  (select md5(string_agg(b.id::text || b.other, ',' order by b.id)) from before b),
  'nothing but the rating changes');
select is(private.rating_only_reviews_fix(), 0, 'a second run changes nothing');
select is(has_function_privilege('authenticated', 'private.rating_only_reviews_fix()', 'execute')
          or has_function_privilege('anon', 'private.rating_from_review_text(text)', 'execute'), false, 'no API role runs the helpers');

select * from finish();
rollback;
