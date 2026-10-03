-- Private, immutable document files with a current version and complete archive.
create schema if not exists it_documents_private;
revoke all on schema it_documents_private from public;
grant usage on schema it_documents_private to anon, authenticated, service_role;

create table public.ops_it_documents (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(btrim(title)) between 1 and 300),
 section text not null check(section in ('how_to','specification')),
 category text not null check(length(btrim(category)) between 1 and 100),
 document_type text not null check(document_type in ('SOP','Troubleshooting guide','Reference','Technical specification')),
 current_version_id uuid,
 source_key text unique,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index ops_it_documents_title_unique on public.ops_it_documents(section,lower(btrim(title)));
create table public.ops_it_document_versions (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.ops_it_documents(id),
 version_number integer not null check(version_number>0),
 storage_path text not null unique,
 file_name text not null check(length(file_name) between 1 and 255),
 mime_type text not null check(mime_type in ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
 file_size integer not null check(file_size between 1 and 20971520),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 change_note text not null check(length(change_note)<=2000),
 uploaded_by text not null,
 uploaded_at timestamptz not null default now(),
 unique(document_id,version_number), unique(document_id,id)
);
alter table public.ops_it_documents add constraint ops_it_document_current_version_fk
 foreign key(id,current_version_id) references public.ops_it_document_versions(document_id,id) deferrable initially deferred;
alter table public.ops_it_documents enable row level security;
alter table public.ops_it_document_versions enable row level security;
create policy ops_it_documents_rpc_only on public.ops_it_documents for all to anon,authenticated using(false) with check(false);
create policy ops_it_document_versions_rpc_only on public.ops_it_document_versions for all to anon,authenticated using(false) with check(false);
revoke all on public.ops_it_documents,public.ops_it_document_versions from public,anon,authenticated;
grant select,insert,update on public.ops_it_documents,public.ops_it_document_versions to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('it-technical-documents','it-technical-documents',false,20971520,array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
 on conflict(id) do nothing;
-- Files are accessed only through the session-validated Edge Function.
create policy it_technical_documents_private on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id <> 'it-technical-documents') with check(bucket_id <> 'it-technical-documents');

create function it_documents_private.context(p_token text,p_write boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c record; is_it boolean; writable boolean;
begin
 select * into c from private.ops_session_context(p_token);
 select exists(select 1 from public.ops_departments d where d.id=c.actor_department_id and d.slug='it-department' and d.active) into is_it;
 writable := (c.actor_role='department' and is_it) or c.actor_role='administrator';
 if not (writable or (not p_write and c.actor_role='management')) then
  raise exception 'Sign in to IT Department or School Administration to manage technical documents.' using errcode='42501';
 end if;
 return jsonb_build_object('role',c.actor_role,'department_id',c.actor_department_id,'can_write',writable);
end;
$$;
revoke all on function it_documents_private.context(text,boolean) from public,anon,authenticated;

create function it_documents_private.bootstrap(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb;
begin
 c := it_documents_private.context(p_token,false);
 return jsonb_build_object('status','success','can_write',c->'can_write','items',(
  select coalesce(jsonb_agg((to_jsonb(d)-'source_key') || jsonb_build_object('versions',
   (select coalesce(jsonb_agg(to_jsonb(v)-'storage_path'-'sha256' order by v.version_number desc),'[]'::jsonb)
    from public.ops_it_document_versions v where v.document_id=d.id)) order by lower(d.title)),'[]'::jsonb)
   from public.ops_it_documents d where d.current_version_id is not null));
end;
$$;
revoke all on function it_documents_private.bootstrap(text) from public;
grant execute on function it_documents_private.bootstrap(text) to anon,authenticated,service_role;
create function public.ops_it_documents_bootstrap(p_session_token text)
returns jsonb language sql security invoker set search_path='' as $$ select it_documents_private.bootstrap(p_session_token); $$;
revoke all on function public.ops_it_documents_bootstrap(text) from public;
grant execute on function public.ops_it_documents_bootstrap(text) to anon,authenticated,service_role;

create function it_documents_private.authorize(p_token text,p_write boolean,p_version_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb; v public.ops_it_document_versions%rowtype;
begin
 c := it_documents_private.context(p_token,p_write);
 if p_version_id is not null then
  select * into v from public.ops_it_document_versions where id=p_version_id;
  if not found then raise exception 'Document version was not found.' using errcode='P0002'; end if;
  return c || jsonb_build_object('version',to_jsonb(v));
 end if;
 return c;
end;
$$;
revoke all on function it_documents_private.authorize(text,boolean,uuid) from public;
grant execute on function it_documents_private.authorize(text,boolean,uuid) to service_role;
create function public.ops_it_document_authorize(p_session_token text,p_write boolean,p_version_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select it_documents_private.authorize(p_session_token,p_write,p_version_id); $$;
revoke all on function public.ops_it_document_authorize(text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.ops_it_document_authorize(text,boolean,uuid) to service_role;

create function it_documents_private.commit_version(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb; d public.ops_it_documents%rowtype; v public.ops_it_document_versions%rowtype;
 did uuid := (p_payload->>'document_id')::uuid; vid uuid := (p_payload->>'version_id')::uuid;
 old_id uuid; next_number integer; author text;
begin
 c := it_documents_private.context(p_token,true);
 select * into d from public.ops_it_documents where id=did for update;
 if found then
  if d.current_version_id is distinct from nullif(p_payload->>'expected_current_version_id','')::uuid then
   return jsonb_build_object('status','conflict','message','A newer version was uploaded while you were working. Refresh the register and try again.');
  end if;
  old_id := d.current_version_id;
  if exists(select 1 from public.ops_it_document_versions where id=old_id and sha256=p_payload->>'sha256') then
   return jsonb_build_object('status','invalid','message','This file is identical to the current version. Choose the revised document.');
  end if;
  if nullif(btrim(p_payload->>'change_note'),'') is null then
   return jsonb_build_object('status','invalid','message','Describe what changed in this version.');
  end if;
 else
  if nullif(p_payload->>'expected_current_version_id','') is not null then
   return jsonb_build_object('status','invalid','message','The original document was not found. Refresh and try again.');
  end if;
  insert into public.ops_it_documents(id,title,section,category,document_type)
   values(did,btrim(p_payload->>'title'),p_payload->>'section',btrim(p_payload->>'category'),p_payload->>'document_type') returning * into d;
 end if;
 if p_payload->>'storage_path' <> did::text||'/'||vid::text||'/'||(p_payload->>'file_name') or not exists(
  select 1 from storage.objects o where o.bucket_id='it-technical-documents' and o.name=p_payload->>'storage_path') then
  raise exception 'The document file has not finished uploading.';
 end if;
 select coalesce(max(version_number),0)+1 into next_number from public.ops_it_document_versions where document_id=did;
 author := case when c->>'role'='administrator' then 'School Administration' else 'IT Department' end;
 insert into public.ops_it_document_versions(id,document_id,version_number,storage_path,file_name,mime_type,file_size,sha256,change_note,uploaded_by)
 values(vid,did,next_number,p_payload->>'storage_path',p_payload->>'file_name',p_payload->>'mime_type',(p_payload->>'file_size')::integer,p_payload->>'sha256',coalesce(btrim(p_payload->>'change_note'),''),author) returning * into v;
 update public.ops_it_documents set current_version_id=vid,updated_at=now() where id=did;
 perform private.ops_audit(c->>'role',(c->>'department_id')::uuid,author,'it_document_version','it_document',did::text,
  jsonb_build_object('old_version_id',old_id,'version_id',vid,'version_number',next_number,'file_name',v.file_name,'sha256',v.sha256,'change_note',v.change_note));
 return jsonb_build_object('status','success','document_id',did,'version_number',next_number,'archived_version_id',old_id);
exception when unique_violation then
 return jsonb_build_object('status','invalid','message','A document with this title already exists. Use Upload new version on that document.');
end;
$$;
revoke all on function it_documents_private.commit_version(text,jsonb) from public;
grant execute on function it_documents_private.commit_version(text,jsonb) to service_role;
create function public.ops_it_document_commit_version(p_session_token text,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select it_documents_private.commit_version(p_session_token,p_payload); $$;
revoke all on function public.ops_it_document_commit_version(text,jsonb) from public,anon,authenticated;
grant execute on function public.ops_it_document_commit_version(text,jsonb) to service_role;
notify pgrst,'reload schema';
