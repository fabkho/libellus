create table public.google_books_cache (
  cache_key text not null,
  expires_at timestamp with time zone not null,
  fetched_at timestamp with time zone default now() not null,
  status text not null,
  volumes jsonb default '[]'::jsonb not null
);

-- constraints
alter table public.google_books_cache add constraint google_books_cache_found_has_volumes CHECK (((status = 'found'::text) = (volumes <> '[]'::jsonb)));
alter table public.google_books_cache add constraint google_books_cache_key_format CHECK (((char_length(cache_key) <= 400) AND (cache_key ~ '^(isbn:97[89][0-9]{10}|(title|q):.+)$'::text)));
alter table public.google_books_cache add constraint google_books_cache_lifetime CHECK (((expires_at > fetched_at) AND (expires_at <= (fetched_at + '1 day'::interval))));
alter table public.google_books_cache add constraint google_books_cache_pkey PRIMARY KEY (cache_key);
alter table public.google_books_cache add constraint google_books_cache_status CHECK ((status = ANY (ARRAY['found'::text, 'not_found'::text])));
alter table public.google_books_cache add constraint google_books_cache_volumes_shape CHECK (
CASE
    WHEN (jsonb_typeof(volumes) = 'array'::text) THEN (jsonb_array_length(volumes) <= 20)
    ELSE false
END);

-- indexes
CREATE INDEX google_books_cache_expires ON public.google_books_cache USING btree (expires_at);

-- row level security
alter table public.google_books_cache enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.google_books_cache to service_role;
grant insert on table public.google_books_cache to service_role;
grant maintain on table public.google_books_cache to service_role;
grant references on table public.google_books_cache to service_role;
grant select on table public.google_books_cache to service_role;
grant trigger on table public.google_books_cache to service_role;
grant truncate on table public.google_books_cache to service_role;
grant update on table public.google_books_cache to service_role;
