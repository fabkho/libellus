create policy push_subscriptions_own on public.push_subscriptions as permissive for select to authenticated
  using ((member_id = ( SELECT auth.uid() AS uid)));
