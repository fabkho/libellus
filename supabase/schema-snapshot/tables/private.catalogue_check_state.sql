create table private.catalogue_check_state (
  attempts integer default 0 not null,
  book_id uuid not null,
  claimed_until timestamp with time zone,
  last_error text,
  not_before timestamp with time zone default now() not null
);

-- constraints
alter table private.catalogue_check_state add constraint catalogue_check_state_book_id_fkey FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE;
alter table private.catalogue_check_state add constraint catalogue_check_state_pkey PRIMARY KEY (book_id);

-- row level security
-- row level security is OFF on private.catalogue_check_state

-- no grants to anon, authenticated, service_role, public
