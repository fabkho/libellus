create table private.follow_calls (
  member_id uuid not null,
  at timestamp with time zone default now() not null
);

-- constraints
alter table private.follow_calls add constraint follow_calls_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- indexes
CREATE INDEX follow_calls_member_at ON private.follow_calls USING btree (member_id, at);

-- row level security
alter table private.follow_calls enable row level security;

-- no grants to anon, authenticated, service_role, public
