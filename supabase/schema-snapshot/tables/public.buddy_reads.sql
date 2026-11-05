create table public.buddy_reads (
  archived_at timestamp with time zone,
  book_id uuid not null,
  client_id uuid not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  finished_at timestamp with time zone,
  host_id uuid,
  id uuid default gen_random_uuid() not null,
  link_token text,
  page_count integer,
  sections_from text default 'count'::text not null,
  starts_on date default CURRENT_DATE not null,
  status text default 'active'::text not null
);

-- constraints
alter table public.buddy_reads add constraint buddy_reads_book_id_fkey FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE RESTRICT;
alter table public.buddy_reads add constraint buddy_reads_host_id_client_id_key UNIQUE (host_id, client_id);
alter table public.buddy_reads add constraint buddy_reads_host_id_fkey FOREIGN KEY (host_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.buddy_reads add constraint buddy_reads_link_token_check CHECK ((link_token ~ '^[A-Za-z0-9_-]{22}$'::text));
alter table public.buddy_reads add constraint buddy_reads_link_token_key UNIQUE (link_token);
alter table public.buddy_reads add constraint buddy_reads_page_count_check CHECK (((page_count >= 1) AND (page_count <= 99999)));
alter table public.buddy_reads add constraint buddy_reads_pkey PRIMARY KEY (id);
alter table public.buddy_reads add constraint buddy_reads_sections_from_check CHECK ((sections_from = ANY (ARRAY['count'::text, 'pages'::text, 'list'::text])));
alter table public.buddy_reads add constraint buddy_reads_status_check CHECK ((status = ANY (ARRAY['active'::text, 'finished'::text, 'archived'::text])));

-- indexes
CREATE INDEX buddy_reads_book ON public.buddy_reads USING btree (book_id);
CREATE UNIQUE INDEX buddy_reads_one_active ON public.buddy_reads USING btree (host_id, book_id) WHERE (status = 'active'::text);

-- row level security
alter table public.buddy_reads enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.buddy_reads to service_role;
grant insert on table public.buddy_reads to service_role;
grant maintain on table public.buddy_reads to service_role;
grant references on table public.buddy_reads to service_role;
grant select on table public.buddy_reads to service_role;
grant trigger on table public.buddy_reads to service_role;
grant truncate on table public.buddy_reads to service_role;
grant update on table public.buddy_reads to service_role;
