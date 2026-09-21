begin;

create table if not exists public.ops_department_pin_setups (
  department_id uuid primary key references public.ops_departments(id) on delete cascade,
  setup_hash text not null,
  status text not null default 'active' check (status in ('active','used','revoked')),
  expires_at timestamptz not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  issued_by_name text,
  issued_by_role text,
  issued_at timestamptz not null default now(),
  used_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.ops_department_pin_setups enable row level security;
revoke all on public.ops_department_pin_setups from anon,authenticated;

create or replace function public.ops_department_pin_setup_overview(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_catalog'
as $function$
declare v_context record; v_setups jsonb;
begin
  select * into v_context from private.ops_session_context(p_session_token);
  if v_context.actor_role<>'administrator' then
    return jsonb_build_object('status','unauthorized','message','School Administration access is required.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'department_id',d.id,
    'setup_status',case
      when s.department_id is null then 'not_issued'
      when s.status='used' then 'used'
      when s.status='revoked' then 'revoked'
      when s.locked_until is not null and s.locked_until>now() then 'locked'
      when s.expires_at<=now() then 'expired'
      else 'active'
    end,
    'expires_at',s.expires_at,'locked_until',s.locked_until,'issued_at',s.issued_at,'issued_by_name',s.issued_by_name
  ) order by d.sort_order,d.name),'[]'::jsonb)
  into v_setups
  from public.ops_departments d
  left join public.ops_department_pin_setups s on s.department_id=d.id
  where d.active and d.workspace_enabled;
  return jsonb_build_object('status','success','setups',v_setups);
exception when sqlstate '28000' then
  return jsonb_build_object('status','unauthorized','message',sqlerrm);
end
$function$;

create or replace function public.ops_generate_department_pin_setup(
  p_session_token text,p_department_id uuid,p_actor_name text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions','pg_catalog'
as $function$
declare v_context record; v_code text; v_expires timestamptz:=now()+interval '24 hours';
begin
  select * into v_context from private.ops_session_context(p_session_token);
  if v_context.actor_role<>'administrator' then
    return jsonb_build_object('status','unauthorized','message','School Administration access is required.');
  end if;
  if nullif(trim(coalesce(p_actor_name,'')),'') is null then
    return jsonb_build_object('status','invalid','message','Enter who is issuing the setup code.');
  end if;
  if not exists(select 1 from public.ops_departments where id=p_department_id and active and workspace_enabled) then
    return jsonb_build_object('status','not_found','message','Department not found.');
  end if;
  v_code:=lpad((((('x'||substr(encode(extensions.gen_random_bytes(4),'hex'),1,8))::bit(32)::bigint)%100000000))::text,8,'0');
  insert into public.ops_department_pin_setups(department_id,setup_hash,status,expires_at,failed_attempts,locked_until,issued_by_name,issued_by_role,issued_at,used_at,updated_at)
  values(p_department_id,extensions.crypt(v_code,extensions.gen_salt('bf',10)),'active',v_expires,0,null,trim(p_actor_name),v_context.actor_role,now(),null,now())
  on conflict(department_id) do update set
    setup_hash=excluded.setup_hash,status='active',expires_at=excluded.expires_at,failed_attempts=0,locked_until=null,
    issued_by_name=excluded.issued_by_name,issued_by_role=excluded.issued_by_role,issued_at=now(),used_at=null,updated_at=now();
  perform private.ops_audit(v_context.actor_role,null,trim(p_actor_name),'generate_department_pin_setup','department',p_department_id::text,jsonb_build_object('expires_at',v_expires));
  return jsonb_build_object('status','success','setup_code',v_code,'expires_at',v_expires);
exception when sqlstate '28000' then
  return jsonb_build_object('status','unauthorized','message',sqlerrm);
end
$function$;

create or replace function public.ops_claim_department_pin(
  p_department_slug text,p_setup_code text,p_new_pin text,p_confirm_pin text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions','pg_catalog'
as $function$
declare v_department public.ops_departments%rowtype; v_setup public.ops_department_pin_setups%rowtype;
begin
  if p_new_pin!~'^[0-9]{4}$' or p_new_pin<>p_confirm_pin then
    return jsonb_build_object('status','invalid','message','Enter and confirm the same four-digit PIN.');
  end if;
  if coalesce(p_setup_code,'')!~'^[0-9]{8}$' then
    return jsonb_build_object('status','invalid','message','Enter the eight-digit one-time setup code.');
  end if;
  select * into v_department from public.ops_departments where slug=lower(trim(coalesce(p_department_slug,''))) and active and workspace_enabled;
  if not found then return jsonb_build_object('status','not_found','message','Department not found.'); end if;
  select * into v_setup from public.ops_department_pin_setups where department_id=v_department.id for update;
  if not found or v_setup.status<>'active' then return jsonb_build_object('status','invalid','message','Ask School Administration for a new one-time setup code.'); end if;
  if v_setup.expires_at<=now() then return jsonb_build_object('status','expired','message','The setup code has expired. Ask School Administration for a new one.'); end if;
  if v_setup.locked_until is not null and v_setup.locked_until>now() then return jsonb_build_object('status','locked','message','Too many incorrect setup-code attempts. Ask School Administration for a new code.'); end if;
  if extensions.crypt(p_setup_code,v_setup.setup_hash)<>v_setup.setup_hash then
    update public.ops_department_pin_setups set failed_attempts=failed_attempts+1,locked_until=case when failed_attempts+1>=5 then now()+interval '15 minutes' else null end,updated_at=now() where department_id=v_department.id;
    return jsonb_build_object('status','unauthorized','message','The one-time setup code is incorrect.');
  end if;
  insert into public.ops_department_credentials(department_id,access_hash,failed_attempts,locked_until,updated_by_role,updated_at)
  values(v_department.id,extensions.crypt(p_new_pin,extensions.gen_salt('bf',10)),0,null,'department',now())
  on conflict(department_id) do update set access_hash=excluded.access_hash,failed_attempts=0,locked_until=null,updated_by_role='department',updated_at=now();
  perform private.system_store_recoverable_pin('department',v_department.id::text,p_new_pin);
  update public.ops_department_pin_setups set status='used',used_at=now(),failed_attempts=0,locked_until=null,updated_at=now() where department_id=v_department.id;
  perform private.ops_audit('department',v_department.id,v_department.name,'claim_department_pin','department',v_department.id::text,'{}'::jsonb);
  return jsonb_build_object('status','success','department_id',v_department.id,'department_name',v_department.name);
end
$function$;

create or replace function public.ops_catalog()
returns jsonb
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
  select jsonb_build_object(
    'status','success',
    'departments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',d.id,'slug',d.slug,'name',d.name,'short_name',d.short_name,'parent_department_id',d.parent_department_id,
        'login_enabled',c.department_id is not null,
        'pin_setup_available',s.status='active' and s.expires_at>now() and (s.locked_until is null or s.locked_until<=now()),
        'pin_setup_expires_at',case when s.status='active' and s.expires_at>now() then s.expires_at else null end
      ) order by d.sort_order,d.name)
      from public.ops_departments d
      left join public.ops_department_credentials c on c.department_id=d.id
      left join public.ops_department_pin_setups s on s.department_id=d.id
      where d.active and d.workspace_enabled
    ),'[]'::jsonb),
    'access_types',jsonb_build_array(
      jsonb_build_object('value','department','label','Department'),
      jsonb_build_object('value','student_leadership','label','Student Leadership'),
      jsonb_build_object('value','management','label','Management'),
      jsonb_build_object('value','administrator','label','School Administration')
    )
  )
$function$;

revoke all on function public.ops_department_pin_setup_overview(text) from public;
revoke all on function public.ops_generate_department_pin_setup(text,uuid,text) from public;
revoke all on function public.ops_claim_department_pin(text,text,text,text) from public;
grant execute on function public.ops_department_pin_setup_overview(text) to anon,authenticated;
grant execute on function public.ops_generate_department_pin_setup(text,uuid,text) to anon,authenticated;
grant execute on function public.ops_claim_department_pin(text,text,text,text) to anon,authenticated;

commit;
