-- Recall storage and synchronization contract, schema version 1.
create table if not exists public.documents (
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity text not null check(entity in ('imports','decks','types','notes','cards','states','reviews','exposures','sessions','activities','attempts','reports','preferences','undos')),
  id text not null, value jsonb not null, row_version bigint not null default 1,
  deleted boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(owner_id,entity,id), check(jsonb_typeof(value)='object'), check(value->>'id'=id)
);
create index if not exists documents_card_deck on public.documents(owner_id,(value->>'deckId')) where entity='cards' and not deleted;
create index if not exists documents_due on public.documents(owner_id,(value->'memory'->>'due')) where entity='states' and not deleted;
create table if not exists public.change_log (
  cursor bigint generated always as identity primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  entity text not null, entity_id text not null, value jsonb not null, row_version bigint not null, deleted boolean not null, created_at timestamptz not null default now()
);
create index if not exists change_log_owner_cursor on public.change_log(owner_id,cursor);
create or replace function public.record_document_change() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.change_log(owner_id,entity,entity_id,value,row_version,deleted) values(new.owner_id,new.entity,new.id,new.value,new.row_version,new.deleted);return new;end $$;
drop trigger if exists documents_changed on public.documents;
create trigger documents_changed after insert or update on public.documents for each row execute function public.record_document_change();
create table if not exists public.mutation_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade, mutation_id uuid not null, receipt jsonb not null, payload jsonb not null, created_at timestamptz not null default now(), primary key(owner_id,mutation_id)
);
create table if not exists public.media_assets (
  owner_id uuid not null references auth.users(id) on delete cascade,id uuid not null,namespace uuid not null,name text not null,hash text not null check(hash ~ '^[a-f0-9]{64}$'),size bigint not null check(size>=0 and size<=67108864),mime text not null,object_key text not null,complete boolean not null default false,created_at timestamptz not null default now(),primary key(owner_id,id),unique(owner_id,namespace,name)
);
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,kind text not null check(kind in ('generate','grade','import','export','cleanup')),
  idempotency_key text not null,status text not null default 'queued' check(status in ('queued','running','succeeded','failed','cancel_requested','cancelled')),
  input jsonb not null,output jsonb,error_code text,attempts int not null default 0,max_attempts int not null default 3,lease_token uuid,lease_until timestamptz,heartbeat_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(owner_id,idempotency_key)
);
create index if not exists jobs_claim on public.jobs(status,lease_until,created_at);
create table if not exists public.reviewer_scopes (
  owner_id uuid not null references auth.users(id) on delete cascade,reviewer_id uuid not null references auth.users(id) on delete cascade,qualification text not null,created_at timestamptz not null default now(),primary key(owner_id,reviewer_id)
);
create table if not exists public.content_audits (
  id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,reviewer_id uuid not null,activity_id text not null,action text not null,content_hash text not null,comment text not null default '',created_at timestamptz not null default now()
);
create table if not exists public.usage_ledger (
  id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,job_id uuid not null references public.jobs(id) on delete cascade,day date not null default current_date,reserved_usd numeric not null default 0,used_usd numeric not null default 0,unique(job_id)
);
do $$ declare tab text;begin foreach tab in array array['documents','change_log','mutation_receipts','media_assets','jobs','content_audits','usage_ledger'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('create policy owner_select on public.%I for select to authenticated using (owner_id = auth.uid())',tab);
  execute format('create policy owner_insert on public.%I for insert to authenticated with check (owner_id = auth.uid())',tab);
  execute format('create policy owner_update on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',tab);
  execute format('create policy owner_delete on public.%I for delete to authenticated using (owner_id = auth.uid())',tab);
end loop;end $$;
alter table public.reviewer_scopes enable row level security;
create policy reviewer_scope_read on public.reviewer_scopes for select to authenticated using(reviewer_id=auth.uid() or owner_id=auth.uid());
grant usage on schema public to authenticated;
grant select,insert,update,delete on public.documents,public.mutation_receipts,public.media_assets,public.jobs,public.content_audits,public.usage_ledger to authenticated;
grant select on public.change_log,public.reviewer_scopes to authenticated;
grant usage,select on all sequences in schema public to authenticated;

-- Persistent workers use their server credential. SKIP LOCKED avoids duplicate claims.
create or replace function public.claim_recall_job(worker_lease uuid) returns setof public.jobs language sql security definer set search_path=public as $$
  update public.jobs set status='running',attempts=attempts+1,lease_token=worker_lease,lease_until=now()+interval '60 seconds',heartbeat_at=now(),updated_at=now()
  where id=(select id from public.jobs where (status='queued' or (status='running' and lease_until<now())) and attempts<max_attempts order by created_at for update skip locked limit 1) returning *;
$$;
revoke all on function public.claim_recall_job(uuid) from public,anon,authenticated;
grant execute on function public.claim_recall_job(uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit) values('recall-media','recall-media',false,67108864) on conflict(id) do nothing;
create policy recall_media_read on storage.objects for select to authenticated using(bucket_id='recall-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy recall_media_insert on storage.objects for insert to authenticated with check(bucket_id='recall-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy recall_media_update on storage.objects for update to authenticated using(bucket_id='recall-media' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='recall-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy recall_media_delete on storage.objects for delete to authenticated using(bucket_id='recall-media' and (storage.foldername(name))[1]=auth.uid()::text);
