-- Social v1 data on top of scripts/perf/seed.sql, for the social migrations of feat/social-v1
-- (20261017*, already applied to the throwaway stack). Throwaway only.
--   docker exec -i <db> psql -U postgres -v confirm=throwaway -v follows=200 -v private_pct=30 < scripts/perf/seed-social.sql
--
--   social_settings  every member; `private_pct` % private
--   follows          member m follows the next `follows` members (m+1 .. m+follows, wrapping), all accepted
--   activity         per member: a `finished` row per finished session of the last year, a `started`
--                    row for each, and a `want` row for each entry added in the last 90 days, visible now
--   blocks           one block per twenty members
\set ON_ERROR_STOP on
\if :{?confirm}
\else
  \echo 'refusing: pass -v confirm=throwaway'
  \quit
\endif
\if :{?follows}
\else
  \set follows 50
\endif
\if :{?private_pct}
\else
  \set private_pct 30
\endif
set session_replication_role = replica;
truncate public.follows, public.blocks, public.follow_link_views, public.activity, public.social_settings;
select count(*) as members from auth.users where email like 'member%@perf.test' \gset

insert into public.social_settings (member_id, private, follow_token)
select id, (random() * 100) < :private_pct, left(translate(encode(gen_random_bytes(16), 'base64'), '+/=', '-_A'), 22)
  from auth.users where email like 'member%@perf.test'
on conflict do nothing;

create temp table perf_m as
select id, row_number() over (order by email) as n from auth.users where email like 'member%@perf.test';

insert into public.follows (follower_id, followee_id, accepted_at)
select a.id, b.id, now() - interval '30 days'
  from perf_m a
  cross join lateral generate_series(1, least(:follows, :members - 1)) k
  join perf_m b on b.n = ((a.n - 1 + k) % :members) + 1
on conflict do nothing;

insert into public.blocks (blocker_id, blocked_id)
select a.id, b.id from perf_m a join perf_m b on b.n = ((a.n + 6) % :members) + 1 where a.n % 20 = 0;

insert into public.activity (member_id, entry_id, session_id, kind, on_day, created_at, visible_at)
select e.member_id, e.id, s.id, k.kind, coalesce(s.ended_on, s.started_on), s.created_at,
       least(now(), coalesce(s.ended_on, s.started_on)::timestamptz + interval '12 hours')
  from public.reading_sessions s
  join public.library_entries e on e.id = s.entry_id
  cross join (values ('started'), ('finished')) k(kind)
 where s.outcome = 'finished' and s.ended_on > current_date - 365
on conflict do nothing;

insert into public.activity (member_id, entry_id, kind, on_day, created_at, visible_at)
select member_id, id, 'want', added_at::date, added_at, least(now(), added_at + interval '1 hour')
  from public.library_entries where added_at > now() - interval '90 days' and status = 'want_to_read';

reset session_replication_role;
analyze public.follows; analyze public.activity; analyze public.social_settings; analyze public.blocks;
select 'follows' as what, count(*) from public.follows union all
select 'activity', count(*) from public.activity union all
select 'followed members with activity (member 2)', count(distinct a.member_id) from public.activity a
  join public.follows f on f.followee_id = a.member_id where f.follower_id = (select id from perf_m where n = 2);
