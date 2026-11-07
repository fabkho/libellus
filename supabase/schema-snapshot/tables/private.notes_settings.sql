create table private.notes_settings (
  id boolean default true not null,
  public_enabled boolean default false not null,
  updated_at timestamp with time zone default now() not null
);

-- constraints
alter table private.notes_settings add constraint notes_settings_id_check CHECK (id);
alter table private.notes_settings add constraint notes_settings_pkey PRIMARY KEY (id);

-- row level security
alter table private.notes_settings enable row level security;

-- no grants to anon, authenticated, service_role, public
