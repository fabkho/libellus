create table private.buddy_voice_settings (
  function_url text,
  id boolean default true not null,
  last_kick_at timestamp with time zone,
  min_interval interval default '00:01:00'::interval not null
);

-- constraints
alter table private.buddy_voice_settings add constraint buddy_voice_settings_function_url_check CHECK ((function_url ~ '^https?://[^[:space:]]+$'::text));
alter table private.buddy_voice_settings add constraint buddy_voice_settings_id_check CHECK (id);
alter table private.buddy_voice_settings add constraint buddy_voice_settings_min_interval_check CHECK ((min_interval >= '00:00:00'::interval));
alter table private.buddy_voice_settings add constraint buddy_voice_settings_pkey PRIMARY KEY (id);

-- row level security
alter table private.buddy_voice_settings enable row level security;

-- no grants to anon, authenticated, service_role, public
