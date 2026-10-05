-- Local development seed. Runs on `supabase start` and `supabase db reset`,
-- never against a hosted project.

-- The invite code for local work: sign up with any address and this code.
-- Plenty of uses, because every Playwright run spends one; `supabase db reset`
-- puts them back. It is documented in the README.
insert into public.invite_codes (code, label, max_uses, expires_at) values
  ('LIBELLUS-DEV', 'Local development', 1000, null);

-- A ready-made member for clicking through the app locally: dev@libellus.local.
-- Sign in with the address; the six-digit code lands in the local mailbox
-- (http://127.0.0.1:55324). Inserted already confirmed, so the signup trigger
-- admits it straight away (an account and one LIBELLUS-DEV use). Not on
-- libellus.test, which the Vitest suite sweeps.
--
-- GoTrue scans the token columns into Go strings, so they must be '' rather
-- than NULL, and the email identity row has to exist for code sign-in.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  'de000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'dev@libellus.local', '', now(),
  '{"provider":"email","providers":["email"]}',
  '{"invite_code":"LIBELLUS-DEV"}',
  now(), now(), '', '', '', ''
);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
values (
  gen_random_uuid(), 'de000000-0000-4000-8000-000000000001',
  'de000000-0000-4000-8000-000000000001', 'email',
  '{"sub":"de000000-0000-4000-8000-000000000001","email":"dev@libellus.local","email_verified":true}',
  now(), now()
);
