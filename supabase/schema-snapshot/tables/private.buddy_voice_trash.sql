create table private.buddy_voice_trash (
  attempts integer default 0 not null,
  last_attempt_at timestamp with time zone,
  path text not null,
  queued_at timestamp with time zone default now() not null
);

-- constraints
alter table private.buddy_voice_trash add constraint buddy_voice_trash_pkey PRIMARY KEY (path);

-- row level security
alter table private.buddy_voice_trash enable row level security;

-- no grants to anon, authenticated, service_role, public
