CREATE OR REPLACE FUNCTION private.cover_gc_weekly()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.cover_gc_enabled() then return 'off'; end if;
  perform public.cover_gc_mark();
  -- A kick that fails (pg_net, the Vault) must not roll the mark back: the claim finds the rows next week anyway.
  begin
    return private.cover_gc_kick();
  exception when others then
    return 'unavailable';
  end;
end
$function$
;
