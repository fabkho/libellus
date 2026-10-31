create table public.goodreads_title_ratings (
  title_key text not null,
  status text not null,
  matched_by text,
  goodreads_id text,
  rating numeric(3,2),
  ratings_count integer,
  reviews_count integer,
  checked_at timestamp with time zone default now() not null,
  cover_url text
);

-- constraints
alter table public.goodreads_title_ratings add constraint goodreads_title_ratings_cover_url CHECK (((cover_url IS NULL) OR (cover_url = ''::text) OR (cover_url ~ '^https://i[.]gr-assets[.]com/[^?#[:space:]]*$'::text)));
alter table public.goodreads_title_ratings add constraint goodreads_title_ratings_found_complete CHECK (
CASE status
    WHEN 'found'::text THEN ((goodreads_id IS NOT NULL) AND (rating IS NOT NULL) AND (ratings_count IS NOT NULL) AND (matched_by IS NOT NULL))
    ELSE ((goodreads_id IS NULL) AND (rating IS NULL) AND (ratings_count IS NULL) AND (reviews_count IS NULL) AND (matched_by IS NULL))
END);
alter table public.goodreads_title_ratings add constraint goodreads_title_ratings_id_format CHECK ((goodreads_id ~ '^[0-9]{1,20}$'::text));
alter table public.goodreads_title_ratings add constraint goodreads_title_ratings_key_format CHECK (((title_key ~ '^[^|]+[|][^|]+$'::text) AND (char_length(title_key) <= 1000)));
alter table public.goodreads_title_ratings add constraint goodreads_title_ratings_matched_by CHECK ((matched_by = 'title'::text));
alter table public.goodreads_title_ratings add constraint goodreads_title_ratings_pkey PRIMARY KEY (title_key);
alter table public.goodreads_title_ratings add constraint goodreads_title_ratings_rating_range CHECK (((rating >= (0)::numeric) AND (rating <= (5)::numeric)));
alter table public.goodreads_title_ratings add constraint goodreads_title_ratings_ratings_count CHECK ((ratings_count >= 0));
alter table public.goodreads_title_ratings add constraint goodreads_title_ratings_reviews_count CHECK ((reviews_count >= 0));
alter table public.goodreads_title_ratings add constraint goodreads_title_ratings_status CHECK ((status = ANY (ARRAY['found'::text, 'not_found'::text])));

-- row level security
alter table public.goodreads_title_ratings enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.goodreads_title_ratings to service_role;
grant insert on table public.goodreads_title_ratings to service_role;
grant maintain on table public.goodreads_title_ratings to service_role;
grant references on table public.goodreads_title_ratings to service_role;
grant select on table public.goodreads_title_ratings to service_role;
grant trigger on table public.goodreads_title_ratings to service_role;
grant truncate on table public.goodreads_title_ratings to service_role;
grant update on table public.goodreads_title_ratings to service_role;
