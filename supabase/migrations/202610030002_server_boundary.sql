-- Browser credentials may read their own records, but cannot bypass scheduler,
-- consent, quota, or medical-approval validation by writing tables directly.
do $$ begin if not exists(select 1 from pg_roles where rolname='recall_server') then create role recall_server nologin;end if;end $$;
grant recall_server to postgres;
grant usage on schema public,auth to recall_server;
grant select,insert,update,delete on public.documents,public.mutation_receipts,public.media_assets,public.jobs,public.content_audits,public.usage_ledger to recall_server;
grant select on public.change_log,public.reviewer_scopes to recall_server;
grant usage,select on all sequences in schema public to recall_server;
grant execute on function auth.uid() to recall_server;
do $$ declare tab text;begin foreach tab in array array['documents','change_log','mutation_receipts','media_assets','jobs','content_audits','usage_ledger'] loop
  execute format('alter policy owner_select on public.%I to authenticated,recall_server',tab);
  execute format('alter policy owner_insert on public.%I to recall_server',tab);
  execute format('alter policy owner_update on public.%I to recall_server',tab);
  execute format('alter policy owner_delete on public.%I to recall_server',tab);
  execute format('revoke insert,update,delete on public.%I from authenticated',tab);
end loop;end $$;
alter policy reviewer_scope_read on public.reviewer_scopes to authenticated,recall_server;

create or replace function public.check_document_references() returns trigger language plpgsql set search_path=public as $$
declare target_entity text;target_id text;ref jsonb;begin
  if new.entity='notes' then target_entity='types';target_id=new.value->>'typeId';
  elsif new.entity='cards' then
    if not exists(select 1 from public.documents where owner_id=new.owner_id and entity='decks' and id=new.value->>'deckId' and not deleted) then raise exception 'Missing owned deck';end if;
    target_entity='notes';target_id=new.value->>'noteId';
  elsif new.entity in ('states','reviews') then target_entity='cards';target_id=case when new.entity='states' then new.id else new.value->>'cardId' end;
  elsif new.entity='attempts' then target_entity='activities';target_id=new.value->>'activityId';
  elsif new.entity='activities' then
    for ref in select * from jsonb_array_elements(new.value->'sources') loop
      if not exists(select 1 from public.documents where owner_id=new.owner_id and entity='notes' and id=ref->>'noteId' and not deleted) then raise exception 'Missing owned activity source';end if;
    end loop;
  end if;
  if target_entity is not null and not exists(select 1 from public.documents where owner_id=new.owner_id and entity=target_entity and id=target_id and not deleted) then raise exception 'Missing owned source reference';end if;
  return new;
end $$;
create trigger documents_check_references before insert or update on public.documents for each row execute function public.check_document_references();
