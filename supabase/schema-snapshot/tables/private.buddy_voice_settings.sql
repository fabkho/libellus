create table private.buddy_voice_settings (
  function_url text,
  id boolean default true not null
);

-- constraints
alter table private.buddy_voice_settings add constraint buddy_voice_settings_function_url_check CHECK ((function_url ~ '^https?://[^[:space:]]+$'::text));
alter table private.buddy_voice_settings add constraint buddy_voice_settings_id_check CHECK (id);
alter table private.buddy_voice_settings add constraint buddy_voice_settings_pkey PRIMARY KEY (id);

-- row level security
-- row level security is OFF on private.buddy_voice_settings

-- no grants to anon, authenticated, service_role, public
