-- Home's second series list stops paying for the first one's work (perf assessment F5,
-- docs/perf/backend.md).
--
-- Home calls started_series and muted_series_list together. Both are
-- started_series_items (p_muted false / true) and each evaluated the whole chain (her
-- entries, sessions, work_series, a lateral NOT EXISTS per candidate series) before the
-- final muted filter: 4.1 + 2.7 ms locally at ~150 entries, 55 ms mean for started_series
-- in production. They are two PostgREST requests, so no SQL helper can share one
-- evaluation between them. What can go is the muted list's chain for a member who muted
-- nothing, almost everyone: her muted list is '[]' whatever the chain would find, and one
-- primary-key probe of muted_series says so. The probe sits in the wrapper, ahead of the
-- call, because the body of a sql function is planned on every call: skipping it inside
-- started_series_items still pays for planning it (1.0 ms against 0.1 ms).
--
-- Same signature, same JSON (an array of items, '[]' when there are none), same items
-- for the same data; started_series and started_series_items are untouched. Invoker
-- rights, so her mutes stay RLS-bound to her. No policy changes.
create or replace function public.muted_series_list(p_limit integer default 50, p_language text default 'en')
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
    when exists (select 1 from public.muted_series ms where ms.member_id = (select auth.uid()))
    then public.started_series_items(p_limit, p_language, true)
    else '[]'::jsonb
  end
$$;
