-- Manual, idempotent setup for the NEW, INDEPENDENT Drast Supabase project only.
-- Setup artifact; not a generated migration history entry. No data is deleted.
begin;

create table if not exists public.drast_records (
  owner text not null check (owner = 'private-workspace'),
  pathname text not null check (pathname ~ '^drast/private-workspace/records/(studies|documents)/[-a-zA-Z0-9_]{1,80}\.json$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (owner, pathname)
);

create table if not exists public.research_jobs (
  owner text not null check (owner = 'private-workspace'),
  id text not null check (id ~ '^[-a-zA-Z0-9_]{1,80}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  version uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  primary key (owner, id)
);
create index if not exists research_jobs_owner_updated_idx on public.research_jobs (owner, updated_at desc);

alter table public.drast_records enable row level security;
alter table public.research_jobs enable row level security;
revoke all on table public.drast_records from public, anon, authenticated;
revoke all on table public.research_jobs from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.drast_records to service_role;
grant select, insert, update, delete on table public.research_jobs to service_role;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('drast-documents','drast-documents',false,15728640,
  array['application/pdf','text/plain','text/csv','application/json','application/octet-stream','application/vnd.ms-excel'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- This restrictive guard protects this bucket even if a permissive policy is
-- added later. It does not change grants or policies for unrelated buckets.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='drast_private_documents_guard') then
    create policy drast_private_documents_guard on storage.objects as restrictive
      for all to anon, authenticated
      using (bucket_id <> 'drast-documents')
      with check (bucket_id <> 'drast-documents');
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
