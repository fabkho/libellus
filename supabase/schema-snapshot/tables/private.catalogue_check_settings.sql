create table private.catalogue_check_settings (
  id boolean default true not null,
  function_url text,
  min_interval interval default '00:00:50'::interval not null,
  last_kick_at timestamp with time zone,
  last_request_id bigint,
  last_status integer,
  last_error text,
  last_status_at timestamp with time zone
);

-- constraints
alter table private.catalogue_check_settings add constraint catalogue_check_settings_function_url_check CHECK ((function_url ~ '^https://[^[:space:]]+$'::text));
alter table private.catalogue_check_settings add constraint catalogue_check_settings_id_check CHECK (id);
alter table private.catalogue_check_settings add constraint catalogue_check_settings_pkey PRIMARY KEY (id);

-- row level security
-- row level security is OFF on private.catalogue_check_settings

-- no grants to anon, authenticated, service_role, public
