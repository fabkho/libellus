CREATE OR REPLACE FUNCTION private.waitlist_email_ok(p_email text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_email is not null
     and char_length(p_email) between 6 and 254
     and p_email !~ '[[:cntrl:][:space:]<>(),;:"\\\[\]]'
     and char_length(split_part(p_email, '@', 1)) between 1 and 64
     and (char_length(p_email) - char_length(replace(p_email, '@', ''))) = 1
     and split_part(p_email, '@', 1) !~ '^\.|\.$|\.\.'
     -- A domain of labels with something in them, at least one dot, and a last label of two or more.
     and split_part(p_email, '@', 2) ~ '^[^.@-][^.@]*(\.[^.@]+)*\.[^.@]{2,}$'
     and split_part(p_email, '@', 2) !~ '(^|\.)-|-(\.|$)'
$function$
;
