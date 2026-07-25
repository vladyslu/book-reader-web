create table if not exists public.book_files (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null,
  title text not null,
  author text not null default '',
  page_count integer not null default 0,
  file_path text not null,
  size_bytes bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

alter table public.book_files enable row level security;

drop policy if exists "Users read own book metadata" on public.book_files;
create policy "Users read own book metadata"
on public.book_files for select
using (auth.uid() = user_id);

drop policy if exists "Users insert own book metadata" on public.book_files;
create policy "Users insert own book metadata"
on public.book_files for insert
with check (auth.uid() = user_id);

drop policy if exists "Users update own book metadata" on public.book_files;
create policy "Users update own book metadata"
on public.book_files for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users delete own book metadata" on public.book_files;
create policy "Users delete own book metadata"
on public.book_files for delete
using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('abrbooks', 'abrbooks', false)
on conflict (id) do nothing;

drop policy if exists "Users read own abrbooks" on storage.objects;
create policy "Users read own abrbooks"
on storage.objects for select
using (
  bucket_id = 'abrbooks'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users upload own abrbooks" on storage.objects;
create policy "Users upload own abrbooks"
on storage.objects for insert
with check (
  bucket_id = 'abrbooks'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users update own abrbooks" on storage.objects;
create policy "Users update own abrbooks"
on storage.objects for update
using (
  bucket_id = 'abrbooks'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'abrbooks'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users delete own abrbooks" on storage.objects;
create policy "Users delete own abrbooks"
on storage.objects for delete
using (
  bucket_id = 'abrbooks'
  and (storage.foldername(name))[1] = auth.uid()::text
);
