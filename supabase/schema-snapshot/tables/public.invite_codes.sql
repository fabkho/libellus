create table public.invite_codes (
  code citext not null,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone,
  id uuid default gen_random_uuid() not null,
  label text,
  max_uses integer default 1 not null,
  uses integer default 0 not null
);

-- constraints
alter table public.invite_codes add constraint invite_codes_code_key UNIQUE (code);
alter table public.invite_codes add constraint invite_codes_code_len CHECK (((char_length((code)::text) >= 4) AND (char_length((code)::text) <= 32)));
alter table public.invite_codes add constraint invite_codes_max_uses_check CHECK ((max_uses > 0));
alter table public.invite_codes add constraint invite_codes_not_overused CHECK ((uses <= max_uses));
alter table public.invite_codes add constraint invite_codes_pkey PRIMARY KEY (id);
alter table public.invite_codes add constraint invite_codes_uses_check CHECK ((uses >= 0));

-- row level security
alter table public.invite_codes enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.invite_codes to service_role;
grant insert on table public.invite_codes to service_role;
grant maintain on table public.invite_codes to service_role;
grant references on table public.invite_codes to service_role;
grant select on table public.invite_codes to service_role;
grant trigger on table public.invite_codes to service_role;
grant truncate on table public.invite_codes to service_role;
grant update on table public.invite_codes to service_role;
