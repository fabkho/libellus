create table private.like_calls (
  member_id uuid not null,
  at timestamp with time zone default now() not null
);

-- constraints
alter table private.like_calls add constraint like_calls_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- indexes
CREATE INDEX like_calls_member_at ON private.like_calls USING btree (member_id, at);

-- row level security
alter table private.like_calls enable row level security;

-- no grants to anon, authenticated, service_role, public
