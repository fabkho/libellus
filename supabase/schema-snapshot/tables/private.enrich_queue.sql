create table private.enrich_queue (
  book_id uuid not null,
  reason text not null,
  enqueued_at timestamp with time zone default now() not null,
  not_before timestamp with time zone default now() not null,
  attempts integer default 0 not null,
  claimed_until timestamp with time zone,
  last_error text
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
