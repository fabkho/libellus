create table public.book_enrichment (
  book_id uuid not null,
  enriched_at timestamp with time zone default now() not null,
  map_version integer,
  signals jsonb default '[]'::jsonb not null,
  sources text[] default '{}'::text[] not null,
  status text not null
);

-- constraints
alter table public.book_enrichment add constraint book_enrichment_book_id_fkey FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE;
alter table public.book_enrichment add constraint book_enrichment_pkey PRIMARY KEY (book_id);
alter table public.book_enrichment add constraint book_enrichment_signals_array CHECK ((jsonb_typeof(signals) = 'array'::text));
alter table public.book_enrichment add constraint book_enrichment_status CHECK ((status = ANY (ARRAY['enriched'::text, 'not_found'::text, 'failed'::text])));

-- indexes
CREATE INDEX book_enrichment_enriched_at ON public.book_enrichment USING btree (enriched_at);

-- row level security
alter table public.book_enrichment enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.book_enrichment to service_role;
grant insert on table public.book_enrichment to service_role;
grant maintain on table public.book_enrichment to service_role;
grant references on table public.book_enrichment to service_role;
grant select on table public.book_enrichment to authenticated;
grant select on table public.book_enrichment to service_role;
grant trigger on table public.book_enrichment to service_role;
grant truncate on table public.book_enrichment to service_role;
grant update on table public.book_enrichment to service_role;
