create table public.google_books_budget (
  day date not null,
  used integer default 0 not null
);

-- constraints
alter table public.google_books_budget add constraint google_books_budget_pkey PRIMARY KEY (day);
alter table public.google_books_budget add constraint google_books_budget_used CHECK ((used >= 0));

-- row level security
alter table public.google_books_budget enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.google_books_budget to service_role;
grant insert on table public.google_books_budget to service_role;
grant maintain on table public.google_books_budget to service_role;
grant references on table public.google_books_budget to service_role;
grant select on table public.google_books_budget to service_role;
grant trigger on table public.google_books_budget to service_role;
grant truncate on table public.google_books_budget to service_role;
grant update on table public.google_books_budget to service_role;
