create table public.goodreads_ratings (
  checked_at timestamp with time zone default now() not null,
  cover_url text,
  goodreads_id text,
  isbn13 text not null,
  matched_by text,
  rating numeric(3,2),
  ratings_count integer,
  reviews_count integer,
  status text not null
);

-- constraints
alter table public.goodreads_ratings add constraint goodreads_ratings_cover_url CHECK (((cover_url IS NULL) OR (cover_url = ''::text) OR (cover_url ~ '^https://i[.]gr-assets[.]com/[^?#[:space:]]*$'::text)));
alter table public.goodreads_ratings add constraint goodreads_ratings_found_complete CHECK (
CASE status
    WHEN 'found'::text THEN ((goodreads_id IS NOT NULL) AND (rating IS NOT NULL) AND (ratings_count IS NOT NULL) AND (matched_by IS NOT NULL))
    ELSE ((goodreads_id IS NULL) AND (rating IS NULL) AND (ratings_count IS NULL) AND (reviews_count IS NULL) AND (matched_by IS NULL))
END);
alter table public.goodreads_ratings add constraint goodreads_ratings_id_format CHECK ((goodreads_id ~ '^[0-9]{1,20}$'::text));
alter table public.goodreads_ratings add constraint goodreads_ratings_isbn13_format CHECK ((isbn13 ~ '^97[89][0-9]{10}$'::text));
alter table public.goodreads_ratings add constraint goodreads_ratings_matched_by CHECK ((matched_by = 'isbn'::text));
alter table public.goodreads_ratings add constraint goodreads_ratings_pkey PRIMARY KEY (isbn13);
alter table public.goodreads_ratings add constraint goodreads_ratings_rating_range CHECK (((rating >= (0)::numeric) AND (rating <= (5)::numeric)));
alter table public.goodreads_ratings add constraint goodreads_ratings_ratings_count CHECK ((ratings_count >= 0));
alter table public.goodreads_ratings add constraint goodreads_ratings_reviews_count CHECK ((reviews_count >= 0));
alter table public.goodreads_ratings add constraint goodreads_ratings_status CHECK ((status = ANY (ARRAY['found'::text, 'not_found'::text])));

-- indexes
CREATE INDEX goodreads_ratings_goodreads_id ON public.goodreads_ratings USING btree (goodreads_id) WHERE (goodreads_id IS NOT NULL);

-- row level security
alter table public.goodreads_ratings enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.goodreads_ratings to service_role;
grant insert on table public.goodreads_ratings to service_role;
grant maintain on table public.goodreads_ratings to service_role;
grant references on table public.goodreads_ratings to service_role;
grant select on table public.goodreads_ratings to authenticated;
grant select on table public.goodreads_ratings to service_role;
grant trigger on table public.goodreads_ratings to service_role;
grant truncate on table public.goodreads_ratings to service_role;
grant update on table public.goodreads_ratings to service_role;
