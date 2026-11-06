create table private.note_calls (
  at timestamp with time zone default now() not null,
  kind text not null,
  member_id uuid not null
);

-- constraints
alter table private.note_calls add constraint note_calls_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- indexes
CREATE INDEX note_calls_member_at ON private.note_calls USING btree (member_id, kind, at);

-- row level security
alter table private.note_calls enable row level security;

-- no grants to anon, authenticated, service_role, public
