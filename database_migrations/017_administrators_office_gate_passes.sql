create or replace function public.ops_administrators_office_gate_passes(
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_catalog'
as $function$
declare
  v_context record;
  v_department_slug text;
  v_holiday boolean := false;
  v_passes jsonb;
begin
  select * into v_context from private.ops_session_context(p_session_token);

  select slug into v_department_slug
  from public.ops_departments
  where id=v_context.actor_department_id;

  if v_context.actor_role<>'department' or v_department_slug<>'administrators-office' then
    raise exception 'Administrator''s Office access is required.' using errcode='42501';
  end if;

  select coalesce((setting_value #>> '{}')::boolean,false)
  into v_holiday
  from public.system_settings
  where setting_key='school_holiday_mode';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',gp.id,
    'student_id',gp.student_id,
    'student_name',s.full_name,
    'registration_number',s.registration_number,
    'destination',gp.destination,
    'reason',gp.reason,
    'contact_details',gp.contact_details,
    'departure_at',gp.departure_at,
    'expected_return_at',gp.expected_return_at,
    'status',gp.status,
    'submitted_at',gp.submitted_at,
    'updated_at',gp.updated_at,
    'created_source',gp.created_source,
    'people',public._gate_pass_people_json(gp.id),
    'approvals',coalesce((
      select jsonb_agg(jsonb_build_object(
        'role',a.approver_role,
        'decision',a.decision,
        'comments',a.comments,
        'decided_at',a.decided_at
      ) order by a.decided_at)
      from public.gate_pass_approvals a
      where a.pass_id=gp.id
    ),'[]'::jsonb),
    'waiting_on',case
      when gp.status<>'pending' then null
      when not exists(
        select 1 from public.gate_pass_approvals a
        where a.pass_id=gp.id and a.approver_role='administrator' and a.decision='approved'
      ) then 'School Administration'
      when not v_holiday and not exists(
        select 1 from public.gate_pass_approvals a
        where a.pass_id=gp.id and a.approver_role in ('principal','dean','director') and a.decision='approved'
      ) then 'Principal, Dean or Director'
      else null
    end,
    'can_edit',gp.status not in ('departed','returned','expired')
  ) order by gp.submitted_at desc),'[]'::jsonb)
  into v_passes
  from public.gate_passes gp
  join public.students s on s.id=gp.student_id;

  return jsonb_build_object(
    'status','success',
    'passes',v_passes,
    'deadline_applies',false,
    'approval_rule',case
      when v_holiday then 'School Administration approval only'
      else 'School Administration plus Principal, Dean or Director'
    end,
    'loaded_at',now()
  );
end;
$function$;

create or replace function public.ops_administrators_office_save_gate_pass(
  p_session_token text,
  p_pass_id uuid,
  p_primary_registration text,
  p_destination text,
  p_reason text,
  p_departure_at timestamptz,
  p_expected_return_at timestamptz,
  p_contact_details text,
  p_companions jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_catalog'
as $function$
declare
  v_context record;
  v_department_slug text;
  v_primary public.students%rowtype;
  v_companion public.students%rowtype;
  v_existing public.gate_passes%rowtype;
  v_pass public.gate_passes%rowtype;
  v_old_status text;
  v_raw text;
  v_reg text;
  v_companion_ids text[] := '{}'::text[];
  v_companion_count integer := 0;
  v_people jsonb;
  v_queued integer := 0;
  v_previous_approvals jsonb := '[]'::jsonb;
begin
  select * into v_context from private.ops_session_context(p_session_token);

  select slug into v_department_slug
  from public.ops_departments
  where id=v_context.actor_department_id;

  if v_context.actor_role<>'department' or v_department_slug<>'administrators-office' then
    raise exception 'Administrator''s Office access is required.' using errcode='42501';
  end if;

  if p_companions is null then p_companions:='[]'::jsonb; end if;
  if jsonb_typeof(p_companions)<>'array' then
    return jsonb_build_object('status','invalid','message','The additional people could not be read. Remove them and add them again.');
  end if;

  select * into v_primary
  from public.students
  where registration_number::text=regexp_replace(coalesce(p_primary_registration,''),'\D','','g')
    and is_active=true
  limit 1;

  if not found then
    return jsonb_build_object('status','not_found','message','Choose an active student from the student register.');
  end if;

  if length(trim(coalesce(p_destination,'')))<2
     or length(trim(coalesce(p_reason,'')))<3
     or length(trim(coalesce(p_contact_details,'')))<3 then
    return jsonb_build_object('status','invalid','message','Complete the destination, reason and contact details.');
  end if;

  if p_departure_at is null or p_expected_return_at is null or p_expected_return_at<=p_departure_at then
    return jsonb_build_object('status','invalid','message','Expected return must be later than departure.');
  end if;

  if p_departure_at<=now() then
    return jsonb_build_object('status','invalid','message','Departure must be in the future.');
  end if;

  if p_pass_id is not null then
    select * into v_existing from public.gate_passes where id=p_pass_id for update;
    if not found then
      return jsonb_build_object('status','not_found','message','Gate pass not found.');
    end if;
    if v_existing.status in ('departed','returned','expired') then
      return jsonb_build_object('status','invalid','message','A pass cannot be edited after travel has started or finished.');
    end if;
  end if;

  if exists(
    select 1
    from public.gate_passes gp
    join public.gate_pass_members gm on gm.pass_id=gp.id
    where gm.student_id=v_primary.id
      and gp.id is distinct from p_pass_id
      and gp.status in ('pending','approved','departed')
      and tstzrange(gp.departure_at,gp.expected_return_at,'[]')
          && tstzrange(p_departure_at,p_expected_return_at,'[]')
  ) then
    return jsonb_build_object('status','schedule_conflict','message',v_primary.full_name||' already has an active pass that overlaps this period.');
  end if;

  for v_raw in
    select distinct value from jsonb_array_elements_text(p_companions)
  loop
    v_reg:=regexp_replace(coalesce(v_raw,''),'\D','','g');
    if v_reg='' then continue; end if;
    if v_reg=v_primary.registration_number::text then
      return jsonb_build_object('status','invalid','message','Do not add the primary student as an additional person.');
    end if;

    select * into v_companion
    from public.students
    where registration_number::text=v_reg and is_active=true
    limit 1;

    if not found then
      return jsonb_build_object('status','invalid','message','Additional student '||v_reg||' was not found.');
    end if;
    if v_companion.id=any(v_companion_ids) then continue; end if;

    v_companion_count:=v_companion_count+1;
    if v_companion_count>5 then
      return jsonb_build_object('status','invalid','message','A gate pass can include up to five additional people.');
    end if;

    if exists(
      select 1
      from public.gate_passes gp
      join public.gate_pass_members gm on gm.pass_id=gp.id
      where gm.student_id=v_companion.id
        and gp.id is distinct from p_pass_id
        and gp.status in ('pending','approved','departed')
        and tstzrange(gp.departure_at,gp.expected_return_at,'[]')
            && tstzrange(p_departure_at,p_expected_return_at,'[]')
    ) then
      return jsonb_build_object('status','schedule_conflict','message',v_companion.full_name||' already has an active pass that overlaps this period.');
    end if;

    v_companion_ids:=array_append(v_companion_ids,v_companion.id);
  end loop;

  if p_pass_id is null then
    insert into public.gate_passes(
      student_id,destination,reason,departure_at,expected_return_at,contact_details,created_source
    ) values (
      v_primary.id,trim(p_destination),trim(p_reason),p_departure_at,p_expected_return_at,trim(p_contact_details),'staff'
    ) returning * into v_pass;

    v_old_status:=null;
  else
    v_old_status:=v_existing.status;

    select coalesce(jsonb_agg(jsonb_build_object(
      'role',approver_role,'decision',decision,'comments',comments,'decided_at',decided_at
    ) order by decided_at),'[]'::jsonb)
    into v_previous_approvals
    from public.gate_pass_approvals
    where pass_id=p_pass_id;

    delete from public.gate_pass_approvals where pass_id=p_pass_id;
    delete from public.gate_pass_members where pass_id=p_pass_id;

    update public.gate_passes
    set student_id=v_primary.id,
        destination=trim(p_destination),
        reason=trim(p_reason),
        departure_at=p_departure_at,
        expected_return_at=p_expected_return_at,
        contact_details=trim(p_contact_details),
        status='pending',
        submitted_at=now(),
        final_approved_at=null,
        actual_departure_at=null,
        actual_return_at=null,
        paper_pass_checked=false,
        cancelled_at=null,
        cancelled_by_role=null,
        cancellation_reason=null,
        created_source='staff',
        updated_at=now()
    where id=p_pass_id
    returning * into v_pass;
  end if;

  if p_pass_id is not null then
    insert into public.gate_pass_members(pass_id,student_id,is_primary,added_by_student_id)
    values(v_pass.id,v_primary.id,true,null);
  end if;

  if array_length(v_companion_ids,1) is not null then
    insert into public.gate_pass_members(pass_id,student_id,is_primary,added_by_student_id)
    select v_pass.id,u.student_id,false,v_primary.id
    from unnest(v_companion_ids) as u(student_id)
    on conflict(pass_id,student_id) do nothing;
  end if;

  insert into public.gate_pass_status_history(pass_id,previous_status,new_status,actor_role,notes)
  values(
    v_pass.id,v_old_status,'pending','administrator',
    case when p_pass_id is null
      then 'Submitted by Administrator''s Office. Student submission deadline bypassed.'
      else 'Edited and resubmitted by Administrator''s Office. Previous approvals were reset.'
    end
  );

  insert into public.audit_log(event_type,entity_type,entity_id,actor_role,action,details)
  values(
    'gate_pass','gate_pass',v_pass.id::text,'department',
    case when p_pass_id is null then 'administrators_office_submitted' else 'administrators_office_edited' end,
    jsonb_build_object(
      'department_id',v_context.actor_department_id,
      'student_id',v_primary.id,
      'registration_number',v_primary.registration_number,
      'companion_count',v_companion_count,
      'deadline_bypassed',true,
      'previous_status',v_old_status,
      'previous_approvals',v_previous_approvals
    )
  );

  v_queued:=private.pass_queue_email(v_pass.id,'submitted');
  v_people:=public._gate_pass_people_json(v_pass.id);

  return jsonb_build_object(
    'status','success',
    'pass_id',v_pass.id,
    'pass_status','pending',
    'people',v_people,
    'deadline_applies',false,
    'approvals_reset',p_pass_id is not null,
    'email_notification_queued',v_queued>0
  );
end;
$function$;

revoke all on function public.ops_administrators_office_gate_passes(text) from public;
revoke all on function public.ops_administrators_office_save_gate_pass(text,uuid,text,text,text,timestamptz,timestamptz,text,jsonb) from public;
grant execute on function public.ops_administrators_office_gate_passes(text) to anon,authenticated;
grant execute on function public.ops_administrators_office_save_gate_pass(text,uuid,text,text,text,timestamptz,timestamptz,text,jsonb) to anon,authenticated;
