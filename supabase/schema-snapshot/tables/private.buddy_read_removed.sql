create table private.buddy_read_removed (
  buddy_read_id uuid not null,
  member_id uuid not null,
  removed_at timestamp with time zone default clock_timestamp() not null
);

-- constraints
alter table private.buddy_read_removed add constraint buddy_read_removed_buddy_read_id_fkey FOREIGN KEY (buddy_read_id) REFERENCES buddy_reads(id) ON DELETE CASCADE;
alter table private.buddy_read_removed add constraint buddy_read_removed_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table private.buddy_read_removed add constraint buddy_read_removed_pkey PRIMARY KEY (buddy_read_id, member_id);

-- indexes
CREATE INDEX buddy_read_removed_member ON private.buddy_read_removed USING btree (member_id);

-- row level security
alter table private.buddy_read_removed enable row level security;

-- no grants to anon, authenticated, service_role, public
