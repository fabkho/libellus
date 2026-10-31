create table private.cover_store_settings (
  id boolean default true not null,
  enabled boolean default false not null,
  function_url text,
  min_interval interval default '00:00:50'::interval not null,
  last_kick_at timestamp with time zone,
  last_request_id bigint
);

-- constraints
alter table private.cover_store_settings add constraint cover_store_settings_function_url_check CHECK ((function_url ~ '^https?://[^[:space:]]+$'::text));
alter table private.cover_store_settings add constraint cover_store_settings_id_check CHECK (id);
alter table private.cover_store_settings add constraint cover_store_settings_pkey PRIMARY KEY (id);

-- row level security
alter table private.cover_store_settings enable row level security;

-- no grants to anon, authenticated, service_role, public
