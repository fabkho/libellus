create table private.book_search (
  book_id uuid not null,
  words tsvector not null,
  title text not null
);

-- constraints
alter table private.book_search add constraint book_search_book_id_fkey FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE;
alter table private.book_search add constraint book_search_pkey PRIMARY KEY (book_id);

-- indexes
CREATE INDEX book_search_words ON private.book_search USING gin (words);

-- row level security
alter table private.book_search enable row level security;

-- no grants to anon, authenticated, service_role, public
