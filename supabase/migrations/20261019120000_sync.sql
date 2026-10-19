-- Radar sync (Phase 3): end-to-end encrypted rows. Every row is encrypted on the device with a
-- key derived from the account's data key; the server stores ciphertext and opaque ids only.
-- Nothing here can decrypt user data.

-- The account's data key wrapped by its recovery key (the recovery part of keys.json). A new
-- device needs the recovery key to open it. Written once, by the first device that syncs.
create table public.sync_vaults (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  recovery   jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.sync_vaults enable row level security;

create policy "Own vault: read" on public.sync_vaults
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own vault: create" on public.sync_vaults
  for insert to authenticated with check ((select auth.uid()) = user_id);

revoke all on public.sync_vaults from anon;
revoke update, delete, truncate on public.sync_vaults from authenticated;

-- One row per synced local row (or deletion). id = HMAC of the row's identity under a key the
-- server never sees. seq orders changes per user, so a device pulls only what is new to it.
-- updated_at is the device's change time: last writer wins per row.
create table public.sync_records (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null check (id ~ '^[0-9a-f]{64}$'),
  seq        bigint not null,
  updated_at timestamptz not null,
  ciphertext text not null check (length(ciphertext) <= 1048576),
  primary key (user_id, id)
);

create index sync_records_user_seq on public.sync_records (user_id, seq);

alter table public.sync_records enable row level security;

create policy "Own records: read" on public.sync_records
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own records: create" on public.sync_records
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own records: update" on public.sync_records
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.sync_records from anon;
revoke delete, truncate on public.sync_records from authenticated;

-- Stores a batch of records. A record replaces the stored one only when it is at least as new
-- (last writer wins). Pushes of one user run one at a time, so seq order is commit order and a
-- pull never skips a row committed late. Returns how many records were written.
create or replace function public.sync_push(records jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  r        jsonb;
  next_seq bigint;
  written  integer := 0;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if jsonb_typeof(records) is distinct from 'array' or jsonb_array_length(records) > 500 then
    raise exception 'Expected an array of at most 500 records' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select coalesce(max(seq), 0) into next_seq from public.sync_records where user_id = uid;

  for r in select value from jsonb_array_elements(records) loop
    next_seq := next_seq + 1;
    insert into public.sync_records as s (user_id, id, seq, updated_at, ciphertext)
    values (uid, r ->> 'id', next_seq, (r ->> 'updated_at')::timestamptz, r ->> 'ciphertext')
    on conflict (user_id, id) do update
      set seq = excluded.seq, updated_at = excluded.updated_at, ciphertext = excluded.ciphertext
      where s.updated_at <= excluded.updated_at;
    if found then
      written := written + 1;
    end if;
  end loop;
  return written;
end;
$$;

revoke execute on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
