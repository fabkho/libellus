create table private.enrich_settings (
  id boolean default true not null,
  function_url text,
  min_interval interval default '00:02:00'::interval not null,
  last_kick_at timestamp with time zone,
  last_request_id bigint
);

-- constraints
alter table private.enrich_settings add constraint enrich_settings_function_url_check CHECK ((function_url ~ '^https?://'::text));
alter table private.enrich_settings add constraint enrich_settings_id_check CHECK (id);
alter table private.enrich_settings add constraint enrich_settings_pkey PRIMARY KEY (id);

-- row level security
-- row level security is OFF on private.enrich_settings

-- no grants to anon, authenticated, service_role, public
