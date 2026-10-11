-- Two foreign keys Social v1 added without an index (perf assessment N4,
-- docs/perf/backend.md). Advisor 0001 would list them once Social v1 is deployed.
--
-- Both are `on delete cascade` from auth.users: delete_my_account (and the purge of
-- abandoned sign-ups) scans the child table once per deleted member without an index
-- on the referencing column. No query of the app reads these columns otherwise.
--
-- Left out on purpose: private.instance_owner.owner_id and private.shelf_publish.owner_id
-- (one row each, `on delete set null`); everything else the advisors name is already
-- served by a partial `where col is not null` index (books_owner, series_created_by,
-- series_parent, entry_series_series, waitlist_*), which the FK check can use.
create index if not exists blocks_blocked_id on public.blocks (blocked_id);
create index if not exists follow_link_views_member_id on public.follow_link_views (member_id);
