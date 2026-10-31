create table private.enrich_queue (
  attempts integer default 0 not null,
  book_id uuid not null,
  claimed_until timestamp with time zone,
  enqueued_at timestamp with time zone default now() not null,
  last_error text,
  not_before timestamp with time zone default now() not null,
  reason text not null
);

-- constraints
alter table private.enrich_queue add constraint enrich_queue_book_id_fkey FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE;
alter table private.enrich_queue add constraint enrich_queue_pkey PRIMARY KEY (book_id);
alter table private.enrich_queue add constraint enrich_queue_reason CHECK ((reason = ANY (ARRAY['new'::text, 'backfill'::text, 'refresh'::text, 'member'::text])));

-- indexes
CREATE INDEX enrich_queue_due ON private.enrich_queue USING btree (not_before);

-- row level security
-- row level security is OFF on private.enrich_queue

-- no grants to anon, authenticated, service_role, public
