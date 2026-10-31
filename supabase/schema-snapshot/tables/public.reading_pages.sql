create table public.reading_pages (
  member_id uuid not null,
  show_favourites boolean default true not null,
  show_finished boolean default true not null,
  show_reading boolean default true not null,
  show_shelf boolean default true not null,
  show_year boolean default true not null,
  token text,
  updated_at timestamp with time zone default now() not null
);

-- constraints
alter table public.reading_pages add constraint reading_pages_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.reading_pages add constraint reading_pages_pkey PRIMARY KEY (member_id);
alter table public.reading_pages add constraint reading_pages_token_format CHECK ((token ~ '^[A-Za-z0-9_-]{22}$'::text));
alter table public.reading_pages add constraint reading_pages_token_key UNIQUE (token);

-- row level security
alter table public.reading_pages enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.reading_pages to service_role;
grant insert on table public.reading_pages to service_role;
grant maintain on table public.reading_pages to service_role;
grant references on table public.reading_pages to service_role;
grant select on table public.reading_pages to authenticated;
grant select on table public.reading_pages to service_role;
grant trigger on table public.reading_pages to service_role;
grant truncate on table public.reading_pages to service_role;
grant update on table public.reading_pages to service_role;
