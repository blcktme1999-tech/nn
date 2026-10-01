-- Supabase schema repair for this workspace.
-- Safe to run multiple times. Existing case data is preserved.
-- Run the entire file in Supabase Dashboard > SQL Editor.

begin;

create extension if not exists pgcrypto;

-- Keep updated_at fresh on every row update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  issuing_place text,
  id_number text,
  gender text,
  birth_date text,
  current_identity text,
  household_registration text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backward compatibility for older databases that already had user_profiles.
alter table public.user_profiles add column if not exists id uuid;
alter table public.user_profiles alter column id set default gen_random_uuid();
update public.user_profiles set id = gen_random_uuid() where id is null;
alter table public.user_profiles alter column id set not null;
create unique index if not exists uq_user_profiles_id on public.user_profiles(id);

-- Ensure primary key is on id (legacy schemas may still have PK on auth_user_id/login_id).
do $$
declare
  id_attnum smallint;
  pk_name text;
  pk_on_id boolean;
begin
  select attnum into id_attnum
  from pg_attribute
  where attrelid = 'public.user_profiles'::regclass
    and attname = 'id'
    and not attisdropped;

  select conname, (conkey = array[id_attnum])
    into pk_name, pk_on_id
  from pg_constraint
  where conrelid = 'public.user_profiles'::regclass
    and contype = 'p';

  if coalesce(pk_on_id, false) = false then
    if pk_name is not null then
      execute format('alter table public.user_profiles drop constraint %I', pk_name);
    end if;
    alter table public.user_profiles add constraint user_profiles_pkey primary key (id);
  end if;
end;
$$;

alter table public.user_profiles add column if not exists display_name text;
alter table public.user_profiles add column if not exists avatar_url text;
alter table public.user_profiles add column if not exists issuing_place text;
alter table public.user_profiles add column if not exists id_number text;
alter table public.user_profiles add column if not exists gender text;
alter table public.user_profiles add column if not exists birth_date text;
alter table public.user_profiles add column if not exists current_identity text;
alter table public.user_profiles add column if not exists household_registration text;
alter table public.user_profiles add column if not exists created_at timestamptz not null default now();
alter table public.user_profiles add column if not exists updated_at timestamptz not null default now();

-- Legacy compatibility: older schemas may still require login_id, but current app does not use it.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_profiles'
      and column_name = 'login_id'
  ) then
    alter table public.user_profiles alter column login_id drop not null;
  end if;
end;
$$;

create table if not exists public.user_records (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.user_profiles(id) on delete cascade,
  title text not null default '未命名案件',
  info_text text not null default '',
  wanted_date text,
  case_category text,
  current_address text,
  filing_unit text,
  case_summary text,
  notes text,
  application_request text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backward compatibility for older databases that already had user_records.
alter table public.user_records add column if not exists profile_id uuid;
alter table public.user_records add column if not exists title text not null default '未命名案件';
alter table public.user_records add column if not exists info_text text not null default '';
alter table public.user_records add column if not exists wanted_date text;
alter table public.user_records add column if not exists case_category text;
alter table public.user_records add column if not exists current_address text;
alter table public.user_records add column if not exists filing_unit text;
alter table public.user_records add column if not exists case_summary text;
alter table public.user_records add column if not exists notes text;
alter table public.user_records add column if not exists application_request text;
alter table public.user_records add column if not exists created_at timestamptz not null default now();
alter table public.user_records add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_records_profile_id_fkey'
      and conrelid = 'public.user_records'::regclass
  ) then
    alter table public.user_records
      add constraint user_records_profile_id_fkey
      foreign key (profile_id) references public.user_profiles(id) on delete cascade;
  end if;
end;
$$;

create table if not exists public.record_photos (
  id bigint generated by default as identity primary key,
  record_id uuid not null references public.user_records(id) on delete cascade,
  photo_url text not null,
  caption text,
  created_at timestamptz not null default now()
);

create table if not exists public.record_messages (
  id bigint generated by default as identity primary key,
  record_id uuid not null references public.user_records(id) on delete cascade,
  sender_role text not null default 'staff',
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.video_chat_messages (
  id bigint generated by default as identity primary key,
  channel text not null,
  sender text not null default '访客',
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_profiles_auth_user_id
  on public.user_profiles(auth_user_id);

create index if not exists idx_user_records_auth_user_id
  on public.user_records(auth_user_id);

create index if not exists idx_user_records_profile_id
  on public.user_records(profile_id);

create index if not exists idx_record_photos_record_id
  on public.record_photos(record_id);

create index if not exists idx_record_messages_record_id
  on public.record_messages(record_id);

create index if not exists idx_video_chat_messages_channel_id
  on public.video_chat_messages(channel, id);

-- Trigger (drop/recreate for idempotency)
drop trigger if exists trg_user_profiles_set_updated_at on public.user_profiles;
create trigger trg_user_profiles_set_updated_at
before update on public.user_profiles
for each row
execute function public.set_updated_at();

drop trigger if exists trg_user_records_set_updated_at on public.user_records;
create trigger trg_user_records_set_updated_at
before update on public.user_records
for each row
execute function public.set_updated_at();

alter table public.user_profiles enable row level security;
alter table public.user_records enable row level security;
alter table public.record_photos enable row level security;
alter table public.record_messages enable row level security;
alter table public.video_chat_messages enable row level security;

-- Clear and recreate policies to avoid drift between environments.
drop policy if exists profile_select_own on public.user_profiles;
create policy profile_select_own on public.user_profiles
  for select to authenticated
  using (auth.uid() = auth_user_id);

drop policy if exists profile_modify_own on public.user_profiles;
create policy profile_modify_own on public.user_profiles
  for all to authenticated
  using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);

drop policy if exists records_select_own on public.user_records;
create policy records_select_own on public.user_records
  for select to authenticated
  using (auth.uid() = auth_user_id);

drop policy if exists records_modify_own on public.user_records;
create policy records_modify_own on public.user_records
  for all to authenticated
  using (auth.uid() = auth_user_id)
  with check (
    auth.uid() = auth_user_id
    and exists (
      select 1
      from public.user_profiles p
      where p.id = profile_id
        and p.auth_user_id = auth.uid()
    )
  );

drop policy if exists photos_select_own on public.record_photos;
create policy photos_select_own on public.record_photos
  for select to authenticated
  using (
    exists (
      select 1
      from public.user_records r
      where r.id = record_id
        and r.auth_user_id = auth.uid()
    )
  );

drop policy if exists photos_modify_own on public.record_photos;
create policy photos_modify_own on public.record_photos
  for all to authenticated
  using (
    exists (
      select 1
      from public.user_records r
      where r.id = record_id
        and r.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.user_records r
      where r.id = record_id
        and r.auth_user_id = auth.uid()
    )
  );

drop policy if exists messages_select_own on public.record_messages;
create policy messages_select_own on public.record_messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.user_records r
      where r.id = record_id
        and r.auth_user_id = auth.uid()
    )
  );

drop policy if exists messages_modify_own on public.record_messages;
create policy messages_modify_own on public.record_messages
  for all to authenticated
  using (
    exists (
      select 1
      from public.user_records r
      where r.id = record_id
        and r.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.user_records r
      where r.id = record_id
        and r.auth_user_id = auth.uid()
    )
  );

drop policy if exists video_chat_messages_select_authenticated on public.video_chat_messages;
create policy video_chat_messages_select_authenticated on public.video_chat_messages
  for select to authenticated
  using (true);

drop policy if exists video_chat_messages_insert_authenticated on public.video_chat_messages;
create policy video_chat_messages_insert_authenticated on public.video_chat_messages
  for insert to authenticated
  with check (true);

-- Public bucket used by /api/admin/upload-image
insert into storage.buckets (id, name, public)
values ('case-photos', 'case-photos', true)
on conflict (id) do update set public = excluded.public;

-- Storage policies
-- Keep in sync with env SUPABASE_STORAGE_BUCKET=case-photos (default in code)
drop policy if exists case_photos_authenticated_insert on storage.objects;
create policy case_photos_authenticated_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'case-photos');

drop policy if exists case_photos_authenticated_update on storage.objects;
create policy case_photos_authenticated_update on storage.objects
  for update to authenticated
  using (bucket_id = 'case-photos')
  with check (bucket_id = 'case-photos');

drop policy if exists case_photos_authenticated_delete on storage.objects;
create policy case_photos_authenticated_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'case-photos');

drop policy if exists case_photos_public_read on storage.objects;
create policy case_photos_public_read on storage.objects
  for select to public
  using (bucket_id = 'case-photos');

notify pgrst, 'reload schema';

commit;

-- Verification results: five tables and one public bucket should be returned.
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'user_profiles',
    'user_records',
    'record_photos',
    'record_messages',
    'video_chat_messages'
  )
order by tablename;

select id, name, public
from storage.buckets
where id = 'case-photos';
