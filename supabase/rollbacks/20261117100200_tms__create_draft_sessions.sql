-- Rollback of 20261117100200_tms__create_draft_sessions.sql: the draft sessions and their planned participants go (with
-- their data), with their guards and helpers; the plan lines lose the course's origin and stamps, and their guards
-- (lines and needs in lines) are the ones of 20261115100200 again (an approved plan's lines no longer move at all).

drop policy plan_lines_course_update on tms.plan_lines;
drop function private.plan_line_sessions_exist(uuid, uuid);
drop function private.plan_need_participants_exist(uuid, uuid, uuid);
drop function private.plan_line_has_sessions(uuid);
drop function private.plan_need_has_participants(uuid, uuid);
drop function private.may_manage_courses(uuid);

drop table tms.session_participants;
drop table tms.sessions;

drop function private.session_participants_guard();
drop function private.sessions_guard();

create or replace function private.plan_lines_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row record := case when tg_op = 'DELETE' then old else new end;
begin
  perform private.training_plan_editable(v_row.tenant_id, v_row.plan_id);
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if (new.plan_id, new.cycle_id, new.group_key) is distinct from (old.plan_id, old.cycle_id, old.group_key) then
      raise exception 'a plan line stays in its plan and keeps what it was built from' using errcode = 'JK001';
    end if;
    -- Every change of a line is L&D's hand.
    new.edited_at := now();
    new.edited_by := private.request_person_id();
  else
    -- A new line is L&D's when they made it (a need moved out); lines built from the needs are not.
    new.edited_at := case when new.edited_at is not null then now() end;
    new.edited_by := case when new.edited_at is not null then private.request_person_id() end;
  end if;
  return new;
end
$$;

comment on function private.plan_lines_guard() is
  'SECURITY-RELEVANT (WP-LD-02). Plan lines change only while the plan is a draft (or sent back); every change is stamped as L&D''s edit.';

create or replace function private.plan_line_needs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row record := case when tg_op = 'DELETE' then old else new end;
  v_status text;
begin
  perform private.training_plan_editable(v_row.tenant_id, v_row.plan_id);
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE'
     and (new.plan_id, new.cycle_id, new.need_id, new.department_id)
         is distinct from (old.plan_id, old.cycle_id, old.need_id, old.department_id) then
    raise exception 'a need''s place in the plan moves from line to line only' using errcode = 'JK001';
  end if;
  select d.status into v_status from tms.plan_cycle_departments d
  where d.tenant_id = new.tenant_id and d.cycle_id = new.cycle_id and d.department_id = new.department_id;
  if tg_op = 'INSERT' and v_status is distinct from 'submitted' then
    raise exception 'only the submitted needs of a department enter the training plan' using errcode = 'JK009';
  end if;
  if tg_op = 'UPDATE' and v_status is distinct from 'submitted' then
    -- A department returned for changes: its figures stay as submitted until it resubmits.
    new.seats := old.seats;
    new.named := old.named;
    new.topic := old.topic;
    new.course_id := old.course_id;
    return new;
  end if;
  -- The snapshot of what the department submitted (never taken from the statement).
  select n.people_count,
         (select count(*) from tms.plan_need_people p where p.tenant_id = n.tenant_id and p.need_id = n.id),
         n.topic, n.course_id
    into new.seats, new.named, new.topic, new.course_id
  from tms.plan_needs n where n.tenant_id = new.tenant_id and n.id = new.need_id;
  if new.seats is null then
    raise insufficient_privilege using message = 'the need is not readable';
  end if;
  return new;
end
$$;

comment on function private.plan_line_needs_guard() is
  'SECURITY-RELEVANT (WP-LD-02). Only submitted needs enter the plan, while it is a draft; seats, named people, topic and course are taken from the need.';


drop function private.plan_line_sessions_lock(uuid);
drop function private.training_plan_locked_status(uuid, uuid);

revoke update (course_origin) on tms.plan_lines from authenticated;
alter table tms.plan_lines
  drop column course_set_by,
  drop column course_set_at,
  drop column course_origin;
