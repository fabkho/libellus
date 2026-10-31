create table public.reading_page_books (
  member_id uuid not null,
  book_id uuid not null,
  review boolean default false not null,
  shared_at timestamp with time zone default now() not null
);

-- constraints
alter table public.reading_page_books add constraint reading_page_books_book_id_fkey FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE;
alter table public.reading_page_books add constraint reading_page_books_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.reading_page_books add constraint reading_page_books_pkey PRIMARY KEY (member_id, book_id);

-- indexes
CREATE INDEX reading_page_books_book ON public.reading_page_books USING btree (book_id);

-- row level security
alter table public.reading_page_books enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.reading_page_books to service_role;
grant insert on table public.reading_page_books to service_role;
grant maintain on table public.reading_page_books to service_role;
grant references on table public.reading_page_books to service_role;
grant select on table public.reading_page_books to authenticated;
grant select on table public.reading_page_books to service_role;
grant trigger on table public.reading_page_books to service_role;
grant truncate on table public.reading_page_books to service_role;
grant update on table public.reading_page_books to service_role;
