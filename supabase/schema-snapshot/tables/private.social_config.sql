create table private.social_config (
  id boolean default true not null,
  settle_window interval default '00:10:00'::interval not null
);

-- constraints
alter table private.social_config add constraint social_config_id_check CHECK (id);
alter table private.social_config add constraint social_config_pkey PRIMARY KEY (id);

-- row level security
alter table private.social_config enable row level security;

-- no grants to anon, authenticated, service_role, public
