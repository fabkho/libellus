create table private.instance_owner (
  id boolean default true not null,
  owner_id uuid
);

-- constraints
alter table private.instance_owner add constraint instance_owner_id_check CHECK (id);
alter table private.instance_owner add constraint instance_owner_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table private.instance_owner add constraint instance_owner_pkey PRIMARY KEY (id);

-- row level security
alter table private.instance_owner enable row level security;

-- no grants to anon, authenticated, service_role, public
