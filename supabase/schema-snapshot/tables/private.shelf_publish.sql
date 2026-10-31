create table private.shelf_publish (
  id boolean default true not null,
  owner_id uuid,
  repository text default 'fabkho/regal'::text not null,
  event_type text default 'libellus-changed'::text not null,
  min_interval interval default '00:10:00'::interval not null,
  last_changed_at timestamp with time zone,
  last_dispatched_at timestamp with time zone,
  last_request_id bigint
);

-- constraints
alter table private.shelf_publish add constraint shelf_publish_event_type_check CHECK ((event_type ~ '^[\w.-]{1,100}$'::text));
alter table private.shelf_publish add constraint shelf_publish_id_check CHECK (id);
alter table private.shelf_publish add constraint shelf_publish_min_interval_check CHECK ((min_interval >= '00:10:00'::interval));
alter table private.shelf_publish add constraint shelf_publish_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table private.shelf_publish add constraint shelf_publish_pkey PRIMARY KEY (id);
alter table private.shelf_publish add constraint shelf_publish_repository_check CHECK ((repository ~ '^[\w.-]+/[\w.-]+$'::text));

-- row level security
-- row level security is OFF on private.shelf_publish

-- no grants to anon, authenticated, service_role, public
