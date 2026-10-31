create table private.import_job_settings (
  function_url text,
  id boolean default true not null,
  last_kick_at timestamp with time zone,
  last_request_id bigint,
  min_interval interval default '00:00:50'::interval not null
);

-- constraints
alter table private.import_job_settings add constraint import_job_settings_function_url_check CHECK ((function_url ~ '^https?://[^[:space:]]+$'::text));
alter table private.import_job_settings add constraint import_job_settings_id_check CHECK (id);
alter table private.import_job_settings add constraint import_job_settings_pkey PRIMARY KEY (id);

-- row level security
-- row level security is OFF on private.import_job_settings

-- no grants to anon, authenticated, service_role, public
