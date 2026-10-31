create table private.profile_link_calls (
  member_id uuid not null,
  at timestamp with time zone default now() not null
);

-- constraints
alter table private.profile_link_calls add constraint profile_link_calls_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- indexes
CREATE INDEX profile_link_calls_member_at ON private.profile_link_calls USING btree (member_id, at);

-- row level security
-- row level security is OFF on private.profile_link_calls

-- no grants to anon, authenticated, service_role, public
