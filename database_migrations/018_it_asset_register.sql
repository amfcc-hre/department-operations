-- IT inventory uses the existing department PIN session. Direct table access is denied.
create schema if not exists it_assets_private;
revoke all on schema it_assets_private from public;
grant usage on schema it_assets_private to anon, authenticated;

create table public.ops_it_assets (
  id uuid primary key default gen_random_uuid(),
  description text not null check (length(btrim(description)) between 1 and 500),
  asset_tag_id text not null default '' check (length(asset_tag_id) <= 200),
  quantity integer not null default 0 check (quantity >= 0),
  status text not null default 'Available' check (length(btrim(status)) between 1 and 100),
  site text not null default 'IT Store' check (length(btrim(site)) between 1 and 200),
  location text not null default '' check (length(location) <= 200),
  brand text not null default '' check (length(brand) <= 200),
  category text not null default '' check (length(category) <= 200),
  model text not null default '' check (length(model) <= 300),
  serial_no text not null default '' check (length(serial_no) <= 300),
  minimum_stock integer default 2 check (minimum_stock >= 0),
  revision integer not null default 1,
  source_reference text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ops_it_assets_tag_unique on public.ops_it_assets (lower(btrim(asset_tag_id))) where btrim(asset_tag_id) <> '';
alter table public.ops_it_assets enable row level security;
create policy ops_it_assets_rpc_only on public.ops_it_assets for all to anon, authenticated using (false) with check (false);
revoke all on public.ops_it_assets from public, anon, authenticated;

create function it_assets_private.context(p_token text, p_write boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context record; v_is_it boolean;
begin
  select * into v_context from private.ops_session_context(p_token);
  select exists(select 1 from public.ops_departments d where d.id=v_context.actor_department_id and d.slug='it-department' and d.active) into v_is_it;
  if not ((v_context.actor_role='department' and v_is_it) or (not p_write and v_context.actor_role in ('management','administrator'))) then
    raise exception 'IT Department access is required to update the asset register.' using errcode='42501';
  end if;
  return jsonb_build_object('role',v_context.actor_role,'department_id',v_context.actor_department_id,'can_write',v_context.actor_role='department' and v_is_it);
end;
$$;
revoke all on function it_assets_private.context(text,boolean) from public, anon, authenticated;

create function it_assets_private.bootstrap(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb;
begin
  v_context := it_assets_private.context(p_token,false);
  return jsonb_build_object('status','success','can_write',v_context->'can_write','items',
    (select coalesce(jsonb_agg(to_jsonb(a) - 'source_reference' order by lower(a.description),a.id),'[]'::jsonb) from public.ops_it_assets a));
end;
$$;

create function it_assets_private.command(p_token text,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_context jsonb; v_before public.ops_it_assets%rowtype; v_after public.ops_it_assets%rowtype;
  v_quantity numeric; v_minimum numeric; v_revision integer; v_fields jsonb; v_actor text;
begin
  v_context := it_assets_private.context(p_token,true);
  if p_action not in ('save','set_quantity','adjust_quantity','set_minimum') or p_action is null then
    return jsonb_build_object('status','invalid','message','Choose a supported asset action.');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('status','invalid','message','Enter the asset details.');
  end if;
  if nullif(p_payload->>'id','') is not null then
    select * into v_before from public.ops_it_assets where id=(p_payload->>'id')::uuid for update;
    if not found then return jsonb_build_object('status','invalid','message','This asset is no longer in the register. Refresh and try again.'); end if;
    v_revision := nullif(p_payload->>'expected_revision','')::integer;
    if v_revision is null or v_revision <> v_before.revision then
      return jsonb_build_object('status','conflict','message','Someone else updated this item. The latest details have been loaded. Please check and try again.','item',to_jsonb(v_before)-'source_reference');
    end if;
  elsif p_action <> 'save' then
    return jsonb_build_object('status','invalid','message','Choose an asset first.');
  end if;
  v_fields := coalesce(p_payload->'fields','{}'::jsonb);
  if jsonb_typeof(v_fields) <> 'object' then return jsonb_build_object('status','invalid','message','Enter valid asset details.'); end if;
  if p_action='adjust_quantity' then
    if nullif(p_payload->>'delta','') is null or (p_payload->>'delta')::numeric not in (-1,1) then
      return jsonb_build_object('status','invalid','message','Use the up or down arrow to change stock by one.');
    end if;
    v_quantity := v_before.quantity::numeric + (p_payload->>'delta')::numeric;
  elsif p_action='set_quantity' then
    v_quantity := nullif(p_payload->>'quantity','')::numeric;
  elsif p_action='save' then
    v_quantity := nullif(v_fields->>'quantity','')::numeric;
  else v_quantity := v_before.quantity;
  end if;
  if v_quantity is null or v_quantity < 0 or v_quantity <> trunc(v_quantity) or v_quantity > 2147483647 then
    return jsonb_build_object('status','invalid','message','Enter a whole-number quantity of zero or more.');
  end if;
  if p_action='set_minimum' then v_minimum := nullif(p_payload->>'minimum_stock','')::numeric;
  elsif p_action='save' then v_minimum := nullif(v_fields->>'minimum_stock','')::numeric;
  else v_minimum := v_before.minimum_stock;
  end if;
  if v_minimum is not null and (v_minimum < 0 or v_minimum <> trunc(v_minimum) or v_minimum > 2147483647) then
    return jsonb_build_object('status','invalid','message','Enter a whole-number minimum of zero or more, or leave it blank to turn low-stock alerts off.');
  end if;
  if p_action='save' then
    if nullif(btrim(v_fields->>'description'),'') is null or nullif(btrim(v_fields->>'site'),'') is null or nullif(btrim(v_fields->>'status'),'') is null then
      return jsonb_build_object('status','invalid','message','Enter the description, site and status.');
    end if;
    if exists(select 1 from jsonb_each_text(v_fields) f where length(f.value)>case f.key when 'description' then 500 when 'model' then 300 when 'serial_no' then 300 when 'status' then 100 else 200 end) then
      return jsonb_build_object('status','invalid','message','One of the asset details is too long. Shorten it and try again.');
    end if;
    if nullif(btrim(v_fields->>'asset_tag_id'),'') is not null and exists(
      select 1 from public.ops_it_assets a where lower(btrim(a.asset_tag_id))=lower(btrim(v_fields->>'asset_tag_id')) and (v_before.id is null or a.id<>v_before.id)
    ) then return jsonb_build_object('status','invalid','message','That asset tag is already in use. Enter a different tag.'); end if;
    if v_before.id is null then
      insert into public.ops_it_assets(description,asset_tag_id,quantity,status,site,location,brand,category,model,serial_no,minimum_stock)
      values(btrim(v_fields->>'description'),coalesce(btrim(v_fields->>'asset_tag_id'),''),v_quantity::integer,btrim(v_fields->>'status'),btrim(v_fields->>'site'),coalesce(btrim(v_fields->>'location'),''),coalesce(btrim(v_fields->>'brand'),''),coalesce(btrim(v_fields->>'category'),''),coalesce(btrim(v_fields->>'model'),''),coalesce(btrim(v_fields->>'serial_no'),''),v_minimum::integer)
      returning * into v_after;
    else
      update public.ops_it_assets set description=btrim(v_fields->>'description'),asset_tag_id=coalesce(btrim(v_fields->>'asset_tag_id'),''),quantity=v_quantity::integer,status=btrim(v_fields->>'status'),site=btrim(v_fields->>'site'),location=coalesce(btrim(v_fields->>'location'),''),brand=coalesce(btrim(v_fields->>'brand'),''),category=coalesce(btrim(v_fields->>'category'),''),model=coalesce(btrim(v_fields->>'model'),''),serial_no=coalesce(btrim(v_fields->>'serial_no'),''),minimum_stock=v_minimum::integer,revision=revision+1,updated_at=now()
      where id=v_before.id returning * into v_after;
    end if;
  else
    update public.ops_it_assets set quantity=v_quantity::integer,minimum_stock=v_minimum::integer,revision=revision+1,updated_at=now()
    where id=v_before.id returning * into v_after;
  end if;
  v_actor := 'IT Department';
  perform private.ops_audit(v_context->>'role',(v_context->>'department_id')::uuid,v_actor,'it_asset_'||p_action,'it_asset',v_after.id::text,
    jsonb_build_object('before',case when v_before.id is null then null else to_jsonb(v_before)-'source_reference' end,'after',to_jsonb(v_after)-'source_reference'));
  return jsonb_build_object('status','success','item',to_jsonb(v_after)-'source_reference');
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('status','invalid','message','Enter valid whole numbers for stock and minimum levels.');
  when unique_violation then
    return jsonb_build_object('status','invalid','message','That asset tag is already in use. Enter a different tag.');
end;
$$;

revoke all on function it_assets_private.bootstrap(text) from public;
revoke all on function it_assets_private.command(text,text,jsonb) from public;
grant execute on function it_assets_private.bootstrap(text), it_assets_private.command(text,text,jsonb) to anon, authenticated;

create function public.ops_it_assets_bootstrap(p_session_token text)
returns jsonb language sql security invoker set search_path = '' as $$
  select it_assets_private.bootstrap(p_session_token);
$$;
create function public.ops_it_assets_command(p_session_token text,p_action text,p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select it_assets_private.command(p_session_token,p_action,p_payload);
$$;
revoke all on function public.ops_it_assets_bootstrap(text), public.ops_it_assets_command(text,text,jsonb) from public;
grant execute on function public.ops_it_assets_bootstrap(text), public.ops_it_assets_command(text,text,jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
