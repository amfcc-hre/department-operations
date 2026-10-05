-- Year-scoped Class Monitors sessions are separate from general department sessions.
-- Initial PINs are provisioned separately, and never included in frontend source.
INSERT INTO public.ops_departments(slug,name,short_name,department_kind,workspace_enabled,restricted_data,active,sort_order)
VALUES('class-monitors','Class Monitors','Class Monitors','operations',true,true,true,95)
ON CONFLICT(slug) DO UPDATE SET name=excluded.name,workspace_enabled=true,restricted_data=true,active=true;
-- This marker makes the existing catalogue recognise a configured department.
-- General department authentication is intercepted before this marker can be used.
INSERT INTO public.ops_department_credentials(department_id,access_hash,updated_by_role)
SELECT id,extensions.crypt(encode(extensions.gen_random_bytes(32),'hex'),extensions.gen_salt('bf',10)),'administrator'
FROM public.ops_departments WHERE slug='class-monitors' ON CONFLICT(department_id) DO NOTHING;

CREATE TABLE private.class_monitor_credentials(
 class_year integer PRIMARY KEY CHECK(class_year BETWEEN 1 AND 3),
 access_hash text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.class_monitor_sessions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash text UNIQUE NOT NULL,
 class_year integer NOT NULL REFERENCES private.class_monitor_credentials(class_year),
 created_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,revoked_at timestamptz
);
CREATE TABLE private.prayer_registers(
 prayer_date date NOT NULL,class_year integer NOT NULL CHECK(class_year BETWEEN 1 AND 3),
 revision integer NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now(),recorded_by text,
 PRIMARY KEY(prayer_date,class_year),CHECK(extract(isodow FROM prayer_date) BETWEEN 1 AND 5)
);
CREATE TABLE private.prayer_register_entries(
 prayer_date date NOT NULL,class_year integer NOT NULL,student_id text NOT NULL,
 student_name text NOT NULL,registration_number text NOT NULL,
 attendance text NOT NULL DEFAULT 'unmarked' CHECK(attendance IN('unmarked','present','absent','excused')),
 campus_status text NOT NULL CHECK(campus_status IN('IN','OUT','unknown')),
 bed_rest boolean NOT NULL DEFAULT false,
 PRIMARY KEY(prayer_date,class_year,student_id),
 FOREIGN KEY(prayer_date,class_year) REFERENCES private.prayer_registers(prayer_date,class_year) ON DELETE CASCADE
);
CREATE TABLE private.class_monitor_notes(
 note_date date NOT NULL,class_year integer NOT NULL CHECK(class_year BETWEEN 1 AND 3),
 body text NOT NULL DEFAULT '' CHECK(length(body)<=8000),revision integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),recorded_by text,
 PRIMARY KEY(note_date,class_year)
);
ALTER TABLE private.class_monitor_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.class_monitor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.prayer_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.prayer_register_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.class_monitor_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.class_monitor_credentials,private.class_monitor_sessions,private.prayer_registers,
 private.prayer_register_entries,private.class_monitor_notes FROM PUBLIC,anon,authenticated;
CREATE INDEX class_monitor_sessions_expiry ON private.class_monitor_sessions(expires_at);

CREATE FUNCTION private.cm_today() RETURNS date LANGUAGE sql STABLE
SET search_path TO pg_catalog AS $$SELECT (now() AT TIME ZONE 'Africa/Harare')::date$$;

CREATE FUNCTION private.cm_login(p_pin text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,extensions,pg_catalog AS $$
DECLARE v_year integer;v_token text;v_department uuid;v_locked timestamptz;v_hours integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('class-monitor-login'));
 SELECT locked_until INTO v_locked FROM public.ops_login_attempts WHERE login_key='department:class-monitors';
 IF v_locked>now() THEN RETURN jsonb_build_object('status','locked','message','Too many unsuccessful attempts. Try again later.'); END IF;
 SELECT class_year INTO v_year FROM private.class_monitor_credentials
 WHERE p_pin ~ '^[0-9]{4}$' AND extensions.crypt(p_pin,access_hash)=access_hash LIMIT 1;
 IF NOT FOUND THEN
  INSERT INTO public.ops_login_attempts(login_key,attempts,last_attempt_at)
  VALUES('department:class-monitors',1,now()) ON CONFLICT(login_key) DO UPDATE SET
   attempts=CASE WHEN ops_login_attempts.last_attempt_at<now()-interval '15 minutes' THEN 1 ELSE ops_login_attempts.attempts+1 END,
   locked_until=NULL,last_attempt_at=now();
  UPDATE public.ops_login_attempts SET locked_until=now()+interval '15 minutes' WHERE login_key='department:class-monitors' AND attempts>=5;
  RETURN jsonb_build_object('status','unauthorized','message','The year-group PIN is incorrect.');
 END IF;
 DELETE FROM public.ops_login_attempts WHERE login_key='department:class-monitors';
 SELECT id INTO v_department FROM public.ops_departments WHERE slug='class-monitors' AND active AND workspace_enabled;
 IF v_department IS NULL THEN RETURN jsonb_build_object('status','unauthorized','message','Class Monitors access is unavailable.'); END IF;
 SELECT greatest(1,least(coalesce((setting_value#>>'{}')::integer,12),24)) INTO v_hours FROM public.ops_settings WHERE setting_key='session_hours';
 v_token:=encode(extensions.gen_random_bytes(32),'hex');
 INSERT INTO private.class_monitor_sessions(token_hash,class_year,expires_at)
 VALUES(private.ops_hash_token(v_token),v_year,now()+make_interval(hours=>coalesce(v_hours,12)));
 DELETE FROM private.class_monitor_sessions WHERE expires_at<now()-interval '7 days';
 PERFORM private.ops_audit('department',v_department,NULL,'class_monitor_login','class_monitors',v_year::text,'{}');
 RETURN jsonb_build_object('status','success','session_token',v_token,'expires_at',now()+make_interval(hours=>coalesce(v_hours,12)),
  'role','department','class_year',v_year,'display_name','Class Monitors · Year '||v_year,
  'department',jsonb_build_object('id',v_department,'slug','class-monitors','name','Class Monitors'));
END $$;

CREATE FUNCTION private.cm_context(p_token text) RETURNS TABLE(viewer_role text,viewer_year integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,pg_catalog AS $$
DECLARE c record;
BEGIN
 IF p_token IS NULL OR length(p_token)<32 THEN RAISE EXCEPTION 'Sign in before opening the register.' USING errcode='28000'; END IF;
 UPDATE private.class_monitor_sessions SET last_seen_at=now()
 WHERE token_hash=private.ops_hash_token(p_token) AND revoked_at IS NULL AND expires_at>now()
 RETURNING class_year INTO viewer_year;
 IF FOUND THEN viewer_role:='class_monitor';RETURN NEXT;RETURN; END IF;
 SELECT * INTO c FROM private.ops_session_context(p_token);
 IF c.actor_role NOT IN('management','student_leadership','administrator') THEN
  RAISE EXCEPTION 'This workspace cannot access prayer registers.' USING errcode='42501';
 END IF;
 viewer_role:=c.actor_role;viewer_year:=NULL;RETURN NEXT;
END $$;

CREATE FUNCTION private.cm_roster(p_date date,p_year integer)
RETURNS TABLE(student_id text,student_name text,registration_number text,attendance text,campus_status text,bed_rest boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public,private,pg_catalog AS $$
 WITH live AS (
  SELECT s.id,s.full_name,s.registration_number::text reg,
   coalesce((SELECT cm.direction FROM public.campus_movements cm WHERE cm.student_id=s.id ORDER BY cm.scanned_at DESC,cm.id DESC LIMIT 1),'IN') campus,
   EXISTS(SELECT 1 FROM public.student_support_statuses x WHERE x.student_id=s.id AND x.is_active AND x.status_type='bed_rest') bed
  FROM public.students s WHERE s.is_active AND public._student_year_number(s.registration_number,extract(year FROM p_date)::integer)=p_year
 )
 SELECT e.student_id,e.student_name,e.registration_number,e.attendance,
  CASE WHEN p_date=private.cm_today() THEN coalesce(l.campus,e.campus_status) ELSE e.campus_status END,
  CASE WHEN p_date=private.cm_today() THEN coalesce(l.bed,e.bed_rest) ELSE e.bed_rest END
 FROM private.prayer_register_entries e LEFT JOIN live l ON l.id=e.student_id
 WHERE e.prayer_date=p_date AND e.class_year=p_year
 UNION ALL
 SELECT l.id,l.full_name,l.reg,'unmarked',CASE WHEN p_date=private.cm_today() THEN l.campus ELSE 'unknown' END,
  CASE WHEN p_date=private.cm_today() THEN l.bed ELSE false END
 FROM live l WHERE NOT EXISTS(SELECT 1 FROM private.prayer_register_entries e WHERE e.prayer_date=p_date AND e.class_year=p_year AND e.student_id=l.id)
 AND (p_date=private.cm_today() OR NOT EXISTS(SELECT 1 FROM private.prayer_registers r WHERE r.prayer_date=p_date AND r.class_year=p_year))
 ORDER BY 2,3
$$;

CREATE FUNCTION private.cm_get(p_token text,p_date date DEFAULT NULL,p_year integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,pg_catalog AS $$
DECLARE c record;v_date date:=coalesce(p_date,private.cm_today());v_year integer;v_rows jsonb;v_reg private.prayer_registers%rowtype;v_note private.class_monitor_notes%rowtype;
BEGIN
 SELECT * INTO c FROM private.cm_context(p_token);
 v_year:=coalesce(p_year,c.viewer_year,1);
 IF v_year NOT BETWEEN 1 AND 3 OR (c.viewer_year IS NOT NULL AND v_year<>c.viewer_year) THEN
  RETURN jsonb_build_object('status','unauthorized','message','This PIN can access only its own year group.'); END IF;
 IF v_date<private.cm_today()-3 OR v_date>private.cm_today() THEN RETURN jsonb_build_object('status','invalid','message','Choose today or one of the previous three days.'); END IF;
 SELECT * INTO v_reg FROM private.prayer_registers WHERE prayer_date=v_date AND class_year=v_year;
 SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') INTO v_rows FROM private.cm_roster(v_date,v_year) r;
 IF c.viewer_role='class_monitor' THEN SELECT * INTO v_note FROM private.class_monitor_notes WHERE note_date=v_date AND class_year=v_year; END IF;
 RETURN jsonb_build_object('status','success','school_today',private.cm_today(),'prayer_date',v_date,'class_year',v_year,
  'viewer_year',c.viewer_year,'viewer_role',c.viewer_role,'prayer_scheduled',extract(isodow FROM v_date) BETWEEN 1 AND 5,
  'can_edit',c.viewer_role='class_monitor' AND v_date=private.cm_today() AND extract(isodow FROM v_date) BETWEEN 1 AND 5,
  'register_saved',coalesce(v_reg.revision,0)>0,'revision',coalesce(v_reg.revision,0),'updated_at',v_reg.updated_at,'recorded_by',v_reg.recorded_by,
  'students',CASE WHEN extract(isodow FROM v_date) BETWEEN 1 AND 5 THEN v_rows ELSE '[]'::jsonb END,
  'notes',CASE WHEN c.viewer_role='class_monitor' THEN jsonb_build_object('body',coalesce(v_note.body,''),'revision',coalesce(v_note.revision,0),'updated_at',v_note.updated_at,'recorded_by',v_note.recorded_by) ELSE NULL END);
EXCEPTION WHEN invalid_authorization_specification OR insufficient_privilege THEN RETURN jsonb_build_object('status','unauthorized','message','Sign in to an authorised workspace.');
END $$;

CREATE FUNCTION private.cm_save(p_token text,p_date date,p_year integer,p_rows jsonb,p_revision integer,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,pg_catalog AS $$
DECLARE c record;v_reg private.prayer_registers%rowtype;v_department uuid;
BEGIN
 SELECT * INTO c FROM private.cm_context(p_token);
 IF c.viewer_role<>'class_monitor' OR c.viewer_year IS DISTINCT FROM p_year THEN RETURN jsonb_build_object('status','unauthorized','message','Only the year group Class Monitors can mark this register.'); END IF;
 IF p_date IS DISTINCT FROM private.cm_today() OR extract(isodow FROM p_date) NOT BETWEEN 1 AND 5 THEN
  RETURN jsonb_build_object('status','invalid','message','Registers can be marked for today, Monday to Friday.'); END IF;
 IF nullif(btrim(p_actor),'') IS NULL OR length(p_actor)>120 THEN RETURN jsonb_build_object('status','invalid','message','Enter the name of the monitor recording this register.'); END IF;
 IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' THEN RETURN jsonb_build_object('status','invalid','message','Attendance rows are required.'); END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) x WHERE coalesce(x->>'attendance','') NOT IN('unmarked','present','absent','excused') OR coalesce(x->>'student_id','')='')
 OR (SELECT count(*) FROM jsonb_array_elements(p_rows))<>(SELECT count(DISTINCT x->>'student_id') FROM jsonb_array_elements(p_rows) x) THEN
  RETURN jsonb_build_object('status','invalid','message','Choose a valid attendance value for each student.'); END IF;
 INSERT INTO private.prayer_registers(prayer_date,class_year) VALUES(p_date,p_year) ON CONFLICT DO NOTHING;
 SELECT * INTO v_reg FROM private.prayer_registers WHERE prayer_date=p_date AND class_year=p_year FOR UPDATE;
 IF p_revision IS DISTINCT FROM v_reg.revision THEN RETURN jsonb_build_object('status','conflict','message','Another monitor saved this register. Reload it before saving.'); END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) x WHERE NOT EXISTS(SELECT 1 FROM private.cm_roster(p_date,p_year) r WHERE r.student_id=x->>'student_id')) THEN
  RETURN jsonb_build_object('status','unauthorized','message','The register contains a student outside this year group.'); END IF;
 INSERT INTO private.prayer_register_entries(prayer_date,class_year,student_id,student_name,registration_number,attendance,campus_status,bed_rest)
 SELECT p_date,p_year,r.student_id,r.student_name,r.registration_number,
  coalesce((SELECT x->>'attendance' FROM jsonb_array_elements(p_rows) x WHERE x->>'student_id'=r.student_id),r.attendance),r.campus_status,r.bed_rest
 FROM private.cm_roster(p_date,p_year) r
 ON CONFLICT(prayer_date,class_year,student_id) DO UPDATE SET attendance=excluded.attendance,campus_status=excluded.campus_status,bed_rest=excluded.bed_rest;
 UPDATE private.prayer_registers SET revision=revision+1,updated_at=now(),recorded_by=btrim(p_actor) WHERE prayer_date=p_date AND class_year=p_year;
 SELECT id INTO v_department FROM public.ops_departments WHERE slug='class-monitors';
 PERFORM private.ops_audit('department',v_department,p_actor,'save_prayer_register','prayer_register',p_date||':'||p_year,jsonb_build_object('class_year',p_year,'date',p_date));
 RETURN private.cm_get(p_token,p_date,p_year);
EXCEPTION WHEN invalid_authorization_specification OR insufficient_privilege THEN RETURN jsonb_build_object('status','unauthorized','message','Sign in to the correct Class Monitors year group.');
END $$;

CREATE FUNCTION private.cm_save_notes(p_token text,p_date date,p_body text,p_revision integer,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,pg_catalog AS $$
DECLARE c record;v_note private.class_monitor_notes%rowtype;v_department uuid;
BEGIN
 SELECT * INTO c FROM private.cm_context(p_token);
 IF c.viewer_role<>'class_monitor' THEN RETURN jsonb_build_object('status','unauthorized','message','Only Class Monitors can save their year group notes.'); END IF;
 IF p_date IS DISTINCT FROM private.cm_today() THEN RETURN jsonb_build_object('status','invalid','message','Notes can be edited for today.'); END IF;
 IF p_body IS NULL OR length(p_body)>8000 OR nullif(btrim(p_actor),'') IS NULL OR length(p_actor)>120 THEN RETURN jsonb_build_object('status','invalid','message','Enter your name and notes of no more than 8,000 characters.'); END IF;
 INSERT INTO private.class_monitor_notes(note_date,class_year) VALUES(p_date,c.viewer_year) ON CONFLICT DO NOTHING;
 SELECT * INTO v_note FROM private.class_monitor_notes WHERE note_date=p_date AND class_year=c.viewer_year FOR UPDATE;
 IF p_revision IS DISTINCT FROM v_note.revision THEN RETURN jsonb_build_object('status','conflict','message','Another monitor saved these notes. Reload before saving.'); END IF;
 UPDATE private.class_monitor_notes SET body=p_body,revision=revision+1,updated_at=now(),recorded_by=btrim(p_actor) WHERE note_date=p_date AND class_year=c.viewer_year;
 SELECT id INTO v_department FROM public.ops_departments WHERE slug='class-monitors';
 PERFORM private.ops_audit('department',v_department,p_actor,'save_class_monitor_notes','class_monitor_notes',p_date||':'||c.viewer_year,'{}');
 RETURN private.cm_get(p_token,p_date,c.viewer_year);
EXCEPTION WHEN invalid_authorization_specification OR insufficient_privilege THEN RETURN jsonb_build_object('status','unauthorized','message','Sign in to Class Monitors.');
END $$;

CREATE FUNCTION private.cm_logout(p_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO private,pg_catalog AS $$
BEGIN UPDATE private.class_monitor_sessions SET revoked_at=now() WHERE token_hash=private.ops_hash_token(p_token);RETURN jsonb_build_object('status','success');END $$;

CREATE FUNCTION private.cm_set_pin(p_token text,p_year integer,p_pin text,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,extensions,pg_catalog AS $$
DECLARE c record;v_department uuid;
BEGIN
 SELECT * INTO c FROM private.ops_session_context(p_token);
 IF c.actor_role<>'administrator' THEN RETURN jsonb_build_object('status','unauthorized','message','School Administration access is required.'); END IF;
 IF p_year IS NULL OR p_year NOT BETWEEN 1 AND 3 OR p_pin IS NULL OR p_pin!~'^[0-9]{4}$' OR nullif(btrim(p_actor),'') IS NULL THEN RETURN jsonb_build_object('status','invalid','message','Choose a year group, enter a four-digit PIN and record your name.'); END IF;
 PERFORM pg_advisory_xact_lock(hashtext('class-monitor-login'));
 IF EXISTS(SELECT 1 FROM private.class_monitor_credentials WHERE class_year<>p_year AND extensions.crypt(p_pin,access_hash)=access_hash) THEN RETURN jsonb_build_object('status','invalid','message','Each year group must have a different PIN.'); END IF;
 INSERT INTO private.class_monitor_credentials(class_year,access_hash) VALUES(p_year,extensions.crypt(p_pin,extensions.gen_salt('bf',10)))
 ON CONFLICT(class_year) DO UPDATE SET access_hash=excluded.access_hash,updated_at=now();
 UPDATE private.class_monitor_sessions SET revoked_at=now() WHERE class_year=p_year AND revoked_at IS NULL;
 SELECT id INTO v_department FROM public.ops_departments WHERE slug='class-monitors';
 PERFORM private.ops_audit(c.actor_role,c.actor_department_id,p_actor,'set_class_monitor_pin','class_monitors',p_year::text,'{}');
 RETURN jsonb_build_object('status','success','message','Year group PIN updated. Existing sessions for that year have ended.');
EXCEPTION WHEN invalid_authorization_specification OR insufficient_privilege THEN RETURN jsonb_build_object('status','unauthorized','message','School Administration access is required.');
END $$;

CREATE FUNCTION public.ops_prayer_register(p_session_token text,p_prayer_date date DEFAULT NULL,p_class_year integer DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO private,pg_catalog AS $$SELECT private.cm_get(p_session_token,p_prayer_date,p_class_year)$$;
CREATE FUNCTION public.ops_prayer_register_save(p_session_token text,p_prayer_date date,p_class_year integer,p_rows jsonb,p_expected_revision integer,p_actor_name text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO private,pg_catalog AS $$SELECT private.cm_save(p_session_token,p_prayer_date,p_class_year,p_rows,p_expected_revision,p_actor_name)$$;
CREATE FUNCTION public.ops_class_monitor_notes_save(p_session_token text,p_note_date date,p_body text,p_expected_revision integer,p_actor_name text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO private,pg_catalog AS $$SELECT private.cm_save_notes(p_session_token,p_note_date,p_body,p_expected_revision,p_actor_name)$$;
CREATE FUNCTION public.ops_class_monitor_logout(p_session_token text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO private,pg_catalog AS $$SELECT private.cm_logout(p_session_token)$$;
CREATE FUNCTION public.ops_class_monitor_set_pin(p_session_token text,p_class_year integer,p_pin text,p_actor_name text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO private,pg_catalog AS $$SELECT private.cm_set_pin(p_session_token,p_class_year,p_pin,p_actor_name)$$;

REVOKE ALL ON FUNCTION private.cm_today(),private.cm_login(text),private.cm_context(text),private.cm_roster(date,integer),
 private.cm_get(text,date,integer),private.cm_save(text,date,integer,jsonb,integer,text),private.cm_save_notes(text,date,text,integer,text),
 private.cm_logout(text),private.cm_set_pin(text,integer,text,text),
 public.ops_prayer_register(text,date,integer),public.ops_prayer_register_save(text,date,integer,jsonb,integer,text),
 public.ops_class_monitor_notes_save(text,date,text,integer,text),public.ops_class_monitor_logout(text),public.ops_class_monitor_set_pin(text,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.cm_get(text,date,integer),private.cm_save(text,date,integer,jsonb,integer,text),
 private.cm_save_notes(text,date,text,integer,text),private.cm_logout(text),private.cm_set_pin(text,integer,text,text),
 public.ops_prayer_register(text,date,integer),public.ops_prayer_register_save(text,date,integer,jsonb,integer,text),
 public.ops_class_monitor_notes_save(text,date,text,integer,text),public.ops_class_monitor_logout(text),public.ops_class_monitor_set_pin(text,integer,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ops_prayer_register(text,date,integer),public.ops_prayer_register_save(text,date,integer,jsonb,integer,text),
 public.ops_class_monitor_notes_save(text,date,text,integer,text),public.ops_class_monitor_logout(text),public.ops_class_monitor_set_pin(text,integer,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
CREATE OR REPLACE FUNCTION public.ops_login(p_access_type text, p_department_slug text, p_access_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog', 'extensions'
AS $function$
declare
  v_department public.ops_departments%rowtype;
  v_credential public.ops_department_credentials%rowtype;
  v_existing_role text;
  v_actor_role text;
  v_login_key text;
  v_attempts public.ops_login_attempts%rowtype;
  v_token text;
  v_hours integer := 12;
  v_expires_at timestamptz;
  v_display_name text;
  v_has_credential boolean := false;
  v_created_rows integer := 0;
begin
  p_access_type := lower(coalesce(btrim(p_access_type), ''));
  p_department_slug := lower(coalesce(btrim(p_department_slug), ''));
  p_access_code := coalesce(p_access_code, '');

  if p_access_type not in ('department','student_leadership','management','administrator') then
    return jsonb_build_object('status','invalid','message','Choose a valid workspace.');
  end if;

  if p_access_type='department' and p_department_slug='class-monitors' then
    return private.cm_login(p_access_code);
  end if;

  v_login_key := case
    when p_access_type = 'department' then 'department:' || coalesce(nullif(p_department_slug,''),'unknown')
    else 'role:' || p_access_type
  end;

  select * into v_attempts
  from public.ops_login_attempts
  where login_key = v_login_key;

  if found and v_attempts.locked_until is not null and v_attempts.locked_until > now() then
    return jsonb_build_object(
      'status','locked',
      'message','Too many unsuccessful attempts. Try again later.',
      'retry_at',v_attempts.locked_until
    );
  end if;

  if p_access_type = 'department' then
    select * into v_department
    from public.ops_departments
    where slug = p_department_slug and active and workspace_enabled;

    if not found then
      v_actor_role := null;
    else
      select exists(
        select 1
        from public.ops_department_credentials
        where department_id = v_department.id
      ) into v_has_credential;

      if not v_has_credential then
        if p_access_code !~ '^[0-9]{4}$' then
          return jsonb_build_object(
            'status','invalid',
            'message','Choose a four-digit department PIN.'
          );
        end if;

        insert into public.ops_department_credentials(
          department_id,access_hash,failed_attempts,locked_until,updated_by_role,updated_at
        )
        values(
          v_department.id,
          extensions.crypt(p_access_code,extensions.gen_salt('bf',10)),
          0,null,'department',now()
        )
        on conflict(department_id) do nothing;

        get diagnostics v_created_rows = row_count;

        if v_created_rows > 0 then
          perform private.system_store_recoverable_pin(
            'department',v_department.id::text,p_access_code
          );
          perform private.ops_audit(
            'department',v_department.id,v_department.name,
            'create_department_pin','department',v_department.id::text,
            jsonb_build_object('method','direct_login')
          );
          v_actor_role := 'department';
          v_display_name := v_department.name;
        else
          select * into v_credential
          from public.ops_department_credentials
          where department_id = v_department.id;

          if found
             and extensions.crypt(p_access_code, v_credential.access_hash) = v_credential.access_hash then
            v_actor_role := 'department';
            v_display_name := v_department.name;
          else
            v_actor_role := null;
          end if;
        end if;
      else
        select * into v_credential
        from public.ops_department_credentials
        where department_id = v_department.id;

        if found
           and extensions.crypt(p_access_code, v_credential.access_hash) = v_credential.access_hash then
          v_actor_role := 'department';
          v_display_name := v_department.name;
        else
          v_actor_role := null;
        end if;
      end if;
    end if;
  else
    v_existing_role := private.tr_actor_from_pin(p_access_code);
    v_actor_role := case
      when p_access_type = 'student_leadership' and v_existing_role = 'student_leadership' then 'student_leadership'
      when p_access_type = 'management' and v_existing_role = 'management' then 'management'
      when p_access_type = 'administrator' and v_existing_role = 'administrator' then 'administrator'
      else null
    end;
    v_display_name := case v_actor_role
      when 'student_leadership' then 'Student Leadership'
      when 'management' then 'Management'
      when 'administrator' then 'School Administration'
      else null
    end;
  end if;

  if v_actor_role is null then
    insert into public.ops_login_attempts(login_key, attempts, locked_until, last_attempt_at)
    values (v_login_key, 1, null, now())
    on conflict (login_key) do update set
      attempts = case
        when public.ops_login_attempts.last_attempt_at < now() - interval '15 minutes' then 1
        else public.ops_login_attempts.attempts + 1
      end,
      last_attempt_at = now(),
      locked_until = null;

    update public.ops_login_attempts
    set locked_until = now() + interval '15 minutes'
    where login_key = v_login_key and attempts >= 5;

    return jsonb_build_object('status','unauthorized','message','The access code is incorrect.');
  end if;

  delete from public.ops_login_attempts where login_key = v_login_key;
  delete from public.ops_access_sessions where expires_at < now() - interval '7 days';

  select coalesce((setting_value #>> '{}')::integer, 12)
  into v_hours
  from public.ops_settings
  where setting_key = 'session_hours';
  v_hours := greatest(1, least(coalesce(v_hours, 12), 24));

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := now() + make_interval(hours => v_hours);

  insert into public.ops_access_sessions(token_hash, actor_role, department_id, expires_at)
  values (
    private.ops_hash_token(v_token),
    v_actor_role,
    case when v_actor_role = 'department' then v_department.id else null end,
    v_expires_at
  );

  perform private.ops_audit(
    v_actor_role,
    case when v_actor_role = 'department' then v_department.id else null end,
    null,
    'login',
    'access_session',
    null,
    jsonb_build_object(
      'access_type', p_access_type,
      'created_department_pin', v_created_rows > 0
    )
  );

  return jsonb_build_object(
    'status','success',
    'session_token',v_token,
    'expires_at',v_expires_at,
    'role',v_actor_role,
    'display_name',v_display_name,
    'department_pin_created',v_created_rows > 0,
    'department',case when v_actor_role = 'department' then jsonb_build_object(
      'id',v_department.id,'slug',v_department.slug,'name',v_department.name
    ) else null end
  );
end;
$function$

