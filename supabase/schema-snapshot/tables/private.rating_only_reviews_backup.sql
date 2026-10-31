create table private.rating_only_reviews_backup (
  at timestamp with time zone default now() not null,
  id uuid not null,
  rating smallint,
  review text,
  review_spoilers boolean
);

-- constraints
alter table private.rating_only_reviews_backup add constraint rating_only_reviews_backup_pkey PRIMARY KEY (id);

-- row level security
alter table private.rating_only_reviews_backup enable row level security;

-- no grants to anon, authenticated, service_role, public
