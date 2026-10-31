CREATE OR REPLACE FUNCTION public.create_invite_code(p_max_uses integer DEFAULT 1, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_label text DEFAULT NULL::text, p_code text DEFAULT NULL::text)
 RETURNS invite_codes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := nullif(trim(p_code), '');
  v_row public.invite_codes;
begin
  if v_code is null then
    v_code := '';
    for i in 1..8 loop
      -- 256 is a multiple of 32, so every character is equally likely.
      v_code := v_code || substr(v_alphabet,
        1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(v_alphabet)), 1);
      if i = 4 then v_code := v_code || '-'; end if;
    end loop;
  end if;

  insert into public.invite_codes (code, label, max_uses, expires_at)
  values (v_code, p_label, p_max_uses, p_expires_at)
  returning * into v_row;

  return v_row;
end;
$function$
;
