create table public.book_works (
  book_id uuid not null,
  work_id uuid not null,
  matched_by text not null
);

-- constraints
alter table public.book_works add constraint book_works_book_id_fkey FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE;
alter table public.book_works add constraint book_works_matched_by CHECK ((matched_by = ANY (ARRAY['openlibrary'::text, 'isbn'::text, 'title'::text])));
alter table public.book_works add constraint book_works_pkey PRIMARY KEY (book_id);
alter table public.book_works add constraint book_works_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;

-- indexes
CREATE INDEX book_works_work ON public.book_works USING btree (work_id);

-- row level security
alter table public.book_works enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.book_works to service_role;
grant insert on table public.book_works to service_role;
grant maintain on table public.book_works to service_role;
grant references on table public.book_works to service_role;
grant select on table public.book_works to authenticated;
grant select on table public.book_works to service_role;
grant trigger on table public.book_works to service_role;
grant truncate on table public.book_works to service_role;
grant update on table public.book_works to service_role;
