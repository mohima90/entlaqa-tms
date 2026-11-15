-- Rollback of 20261117100200_tms__create_draft_sessions.sql: the draft sessions and their planned participants go (with
-- their data), with their guards and helpers; the plan lines lose the course's origin and stamps, and their guard is
-- the one of 20261115100200 again (an approved plan's lines no longer move at all).

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

comment on function private.plan_lines_guard() is
  'SECURITY-RELEVANT (WP-LD-02). Plan lines change only while the plan is a draft (or sent back); every change is stamped as L&D''s edit.';

drop function private.plan_line_sessions_lock(uuid);
drop function private.training_plan_locked_status(uuid, uuid);

revoke update (course_origin) on tms.plan_lines from authenticated;
alter table tms.plan_lines drop constraint plan_lines_line_key_uq;
alter table tms.plan_lines
  drop column course_set_by,
  drop column course_set_at,
  drop column course_origin;
