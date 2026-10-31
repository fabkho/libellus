create table private.client_error_salt (
  id boolean default true not null,
  salt text default ((gen_random_uuid())::text || (gen_random_uuid())::text) not null
);

-- constraints
alter table private.client_error_salt add constraint client_error_salt_id_check CHECK (id);
alter table private.client_error_salt add constraint client_error_salt_pkey PRIMARY KEY (id);

-- row level security
alter table private.client_error_salt enable row level security;

-- no grants to anon, authenticated, service_role, public
