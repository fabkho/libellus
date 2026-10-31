create table private.catalogue_additions (
  member_id uuid not null,
  day date default CURRENT_DATE not null,
  n integer default 0 not null
);

-- constraints
alter table private.catalogue_additions add constraint catalogue_additions_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table private.catalogue_additions add constraint catalogue_additions_pkey PRIMARY KEY (member_id, day);

-- row level security
-- row level security is OFF on private.catalogue_additions

-- no grants to anon, authenticated, service_role, public
