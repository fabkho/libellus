create table private.cover_objects (
  key text not null,
  widths smallint[],
  content_type text,
  bytes bigint,
  stored_at timestamp with time zone,
  orphaned_at timestamp with time zone,
  deleting_at timestamp with time zone,
  gc_retry_at timestamp with time zone
);

-- constraints
alter table private.cover_objects add constraint cover_objects_key_check CHECK ((key ~ '^[0-9a-f]{32}$'::text));
alter table private.cover_objects add constraint cover_objects_pkey PRIMARY KEY (key);

-- row level security
alter table private.cover_objects enable row level security;

-- no grants to anon, authenticated, service_role, public
