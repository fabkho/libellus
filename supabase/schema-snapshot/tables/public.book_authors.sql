create table public.book_authors (
  author_id uuid not null,
  book_id uuid not null,
  "position" smallint not null
);

-- constraints
alter table public.book_authors add constraint book_authors_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE;
alter table public.book_authors add constraint book_authors_book_id_fkey FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE;
alter table public.book_authors add constraint book_authors_pkey PRIMARY KEY (book_id, "position");
alter table public.book_authors add constraint book_authors_position_positive CHECK (("position" > 0));

-- indexes
CREATE INDEX book_authors_author ON public.book_authors USING btree (author_id);

-- row level security
alter table public.book_authors enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.book_authors to service_role;
grant insert on table public.book_authors to service_role;
grant maintain on table public.book_authors to service_role;
grant references on table public.book_authors to service_role;
grant select on table public.book_authors to authenticated;
grant select on table public.book_authors to service_role;
grant trigger on table public.book_authors to service_role;
grant truncate on table public.book_authors to service_role;
grant update on table public.book_authors to service_role;
