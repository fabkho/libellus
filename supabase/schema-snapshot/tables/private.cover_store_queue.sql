create table private.cover_store_queue (
  attempts integer default 0 not null,
  book_id uuid not null,
  due_at timestamp with time zone default now() not null,
  enqueued_at timestamp with time zone default now() not null,
  last_error text,
  leased_by text,
  leased_until timestamp with time zone,
  source_url text not null,
  state text default 'queued'::text not null
);

-- constraints
alter table private.cover_store_queue add constraint cover_store_queue_book_id_fkey FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE;
alter table private.cover_store_queue add constraint cover_store_queue_pkey PRIMARY KEY (book_id);
alter table private.cover_store_queue add constraint cover_store_queue_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'leased'::text, 'failed'::text, 'gone'::text, 'unsupported'::text])));

-- indexes
CREATE INDEX cover_store_queue_due ON private.cover_store_queue USING btree (due_at) WHERE (state = ANY (ARRAY['queued'::text, 'failed'::text]));
CREATE INDEX cover_store_queue_leased ON private.cover_store_queue USING btree (leased_until) WHERE (state = 'leased'::text);

-- row level security
alter table private.cover_store_queue enable row level security;

-- no grants to anon, authenticated, service_role, public
