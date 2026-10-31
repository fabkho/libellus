create table public.books (
  apple_id text,
  authors text[] default '{}'::text[] not null,
  check_failed boolean default false not null,
  check_unknown boolean default false not null,
  checked_at timestamp with time zone,
  cover_dominant text,
  cover_key text,
  cover_secondary text,
  cover_thumbhash text,
  cover_url text,
  cover_widths smallint[],
  created_at timestamp with time zone default now() not null,
  description text,
  format book_format,
  id uuid default gen_random_uuid() not null,
  isbn10 text,
  isbn13 text,
  language text,
  openlibrary_edition_key text,
  openlibrary_work_key text,
  owner_id uuid,
  page_count integer,
  published_year smallint,
  publisher text,
  source book_source not null,
  title text not null
);

-- constraints
alter table public.books add constraint books_apple_id_format CHECK ((apple_id ~ '^[0-9]+$'::text));
alter table public.books add constraint books_authors_present CHECK ((array_position(authors, NULL::text) IS NULL));
alter table public.books add constraint books_catalogue_key CHECK (((source = 'manual'::book_source) OR check_failed OR (COALESCE(isbn13, apple_id, openlibrary_edition_key) IS NOT NULL)));
alter table public.books add constraint books_check_one_state CHECK ((NOT (check_failed AND check_unknown)));
alter table public.books add constraint books_cover_dominant_hex CHECK ((cover_dominant ~ '^#[0-9a-f]{6}$'::text));
alter table public.books add constraint books_cover_key_format CHECK ((cover_key ~ '^[0-9a-f]{32}$'::text));
alter table public.books add constraint books_cover_key_has_widths CHECK (((cover_key IS NULL) = (cover_widths IS NULL)));
alter table public.books add constraint books_cover_secondary_hex CHECK ((cover_secondary ~ '^#[0-9a-f]{6}$'::text));
alter table public.books add constraint books_cover_url_allowed CHECK (((source = 'manual'::book_source) OR (cover_url IS NULL) OR private.cover_allowed(cover_url)));
alter table public.books add constraint books_cover_widths_sane CHECK (((cover_widths IS NULL) OR (((cardinality(cover_widths) >= 1) AND (cardinality(cover_widths) <= 6)) AND (16 <= ALL (cover_widths)) AND (2000 >= ALL (cover_widths)))));
alter table public.books add constraint books_isbn10_format CHECK ((isbn10 ~ '^[0-9]{9}[0-9X]$'::text));
alter table public.books add constraint books_isbn13_format CHECK ((isbn13 ~ '^97[89][0-9]{10}$'::text));
alter table public.books add constraint books_manual_unchecked CHECK (((owner_id IS NULL) OR ((checked_at IS NULL) AND (NOT check_failed) AND (NOT check_unknown))));
alter table public.books add constraint books_openlibrary_edition_key_format CHECK ((openlibrary_edition_key ~ '^OL[1-9][0-9]{0,11}M$'::text));
alter table public.books add constraint books_openlibrary_work_key_format CHECK ((openlibrary_work_key ~ '^OL[1-9][0-9]{0,11}W$'::text));
alter table public.books add constraint books_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.books add constraint books_owner_iff_manual CHECK (((source = 'manual'::book_source) = (owner_id IS NOT NULL)));
alter table public.books add constraint books_page_count_positive CHECK ((page_count > 0));
alter table public.books add constraint books_pkey PRIMARY KEY (id);
alter table public.books add constraint books_title_present CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 500)));
alter table public.books add constraint books_year_plausible CHECK (((published_year >= 1) AND (published_year <= 2100)));

-- indexes
CREATE UNIQUE INDEX books_catalogue_apple_id ON public.books USING btree (apple_id) WHERE ((owner_id IS NULL) AND (apple_id IS NOT NULL));
CREATE UNIQUE INDEX books_catalogue_isbn13 ON public.books USING btree (isbn13) WHERE ((owner_id IS NULL) AND (isbn13 IS NOT NULL));
CREATE UNIQUE INDEX books_catalogue_openlibrary_edition_key ON public.books USING btree (openlibrary_edition_key) WHERE ((owner_id IS NULL) AND (openlibrary_edition_key IS NOT NULL));
CREATE INDEX books_cover_unstored ON public.books USING btree (id) WHERE ((cover_key IS NULL) AND (cover_url IS NOT NULL));
CREATE INDEX books_openlibrary_work_key ON public.books USING btree (openlibrary_work_key) WHERE (openlibrary_work_key IS NOT NULL);
CREATE INDEX books_owner ON public.books USING btree (owner_id) WHERE (owner_id IS NOT NULL);
CREATE INDEX books_unchecked ON public.books USING btree (created_at) WHERE ((owner_id IS NULL) AND (checked_at IS NULL));
CREATE INDEX books_work_title_key ON public.books USING btree (work_title_key(title));

-- row level security
alter table public.books enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.books to service_role;
grant insert on table public.books to service_role;
grant maintain on table public.books to service_role;
grant references on table public.books to service_role;
grant select on table public.books to authenticated;
grant select on table public.books to service_role;
grant trigger on table public.books to service_role;
grant truncate on table public.books to service_role;
grant update on table public.books to service_role;
