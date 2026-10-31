create table private.waitlist_joins (
  id bigint generated always as identity not null,
  caller_key text not null,
  created_at timestamp with time zone default now() not null
);

-- constraints
alter table private.waitlist_joins add constraint waitlist_joins_pkey PRIMARY KEY (id);

-- indexes
CREATE INDEX waitlist_joins_caller_created_at ON private.waitlist_joins USING btree (caller_key, created_at);
CREATE INDEX waitlist_joins_created_at ON private.waitlist_joins USING btree (created_at);

-- row level security
alter table private.waitlist_joins enable row level security;

-- no grants to anon, authenticated, service_role, public
