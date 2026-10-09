-- The two foreign keys Social v1 added without an index (perf assessment N4):
--   supabase test db
--
-- Both cascade from auth.users, so deleting a member scans the table once per child
-- unless the referencing column is indexed.

begin;
select plan(2);

select has_index('public', 'blocks', 'blocks_blocked_id', 'blocked_id', 'blocks.blocked_id is indexed');
select has_index('public', 'follow_link_views', 'follow_link_views_member_id', 'member_id',
                 'follow_link_views.member_id is indexed');

select * from finish();
rollback;
