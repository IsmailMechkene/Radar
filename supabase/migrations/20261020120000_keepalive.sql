-- Keep-alive for scripts/supabase-keepalive.mjs: free projects are paused after about a week
-- without database activity. Returns only the server time; reads no table, so the anonymous
-- role can call it without being granted anything on user data.
create or replace function public.keepalive()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$ select now() $$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
