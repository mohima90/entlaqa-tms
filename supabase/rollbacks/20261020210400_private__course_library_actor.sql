-- Rollback of 20261020210400_private__course_library_actor.sql: the actor check back in the tms schema
-- (20261020120100).

create or replace function tms.course_library_actor(p_tenant_id uuid, p_permission text, p_refusal text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_kind text := private.request_claims() ->> 'role';
  v_user uuid := private.request_user_id();
begin
  if current_user <> 'authenticated' then
    return false;  -- platform operation
  end if;
  if p_tenant_id is distinct from private.current_tenant_id() then
    return false;  -- row-level security rejects it
  end if;
  if v_kind is distinct from 'authenticated' or v_user is null then
    raise exception 'only signed-in members change the course library' using errcode = 'insufficient_privilege';
  end if;
  if not private.member_has_permission(p_tenant_id, v_user, p_permission) then
    raise exception '%', p_refusal using errcode = 'insufficient_privilege';
  end if;
  return true;
end
$$;

comment on function tms.course_library_actor(uuid, text, text) is
  'SECURITY-RELEVANT (T-M3-03). The signed-in member changing the course library must hold the permission organization-wide.';

revoke all on function tms.course_library_actor(uuid, text, text) from public;
grant execute on function tms.course_library_actor(uuid, text, text) to authenticated;

create or replace function tms.guard_course_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.id, new.tenant_id) is distinct from (old.id, old.tenant_id) then
    raise exception 'a category cannot change its id or organization' using errcode = 'insufficient_privilege';
  end if;
  perform tms.course_library_actor(new.tenant_id, 'tms.course.manage',
    'only members who manage the course library can add or change categories');
  return new;
end
$$;

create or replace function tms.guard_course()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_content_changed boolean;
  v_costs_changed boolean;
begin
  if tg_op = 'INSERT' then
    perform tms.course_library_actor(new.tenant_id, 'tms.course.manage',
      'only members who manage the course library can add courses');
    v_costs_changed := true;
    if new.status = 'archived' then
      new.archived_at := now();
      new.archived_by := private.request_person_id();
    else
      new.archived_at := null;
      new.archived_by := null;
    end if;
  else
    if (new.id, new.tenant_id) is distinct from (old.id, old.tenant_id) then
      raise exception 'a course cannot change its id or organization' using errcode = 'insufficient_privilege';
    end if;
    v_content_changed := (new.code, new.title_en, new.title_ar, new.description_en, new.description_ar,
                          new.category_id, new.delivery_type, new.duration_hours, new.duration_days,
                          new.min_participants, new.max_participants, new.est_cost_per_session,
                          new.est_cost_per_participant)
      is distinct from (old.code, old.title_en, old.title_ar, old.description_en, old.description_ar,
                        old.category_id, old.delivery_type, old.duration_hours, old.duration_days,
                        old.min_participants, old.max_participants, old.est_cost_per_session,
                        old.est_cost_per_participant);
    if v_content_changed then
      perform tms.course_library_actor(new.tenant_id, 'tms.course.manage',
        'only members who manage the course library can change courses');
    end if;
    if new.status is distinct from old.status then
      perform tms.course_library_actor(new.tenant_id, 'tms.course.archive',
        'only members who may archive courses can archive or restore them');
      if new.status = 'archived' then
        new.archived_at := now();
        new.archived_by := private.request_person_id();
      else
        new.archived_at := null;
        new.archived_by := null;
      end if;
    else
      new.archived_at := old.archived_at;
      new.archived_by := old.archived_by;
      if not v_content_changed then
        -- Nothing changed: still only for members who may change the library.
        perform tms.course_library_actor(new.tenant_id, 'tms.course.manage',
          'only members who manage the course library can change courses');
      end if;
    end if;
    v_costs_changed := (new.est_cost_per_session, new.est_cost_per_participant)
      is distinct from (old.est_cost_per_session, old.est_cost_per_participant);
    if not v_costs_changed then
      new.cost_currency := old.cost_currency;
    end if;
  end if;
  -- The costs' currency: the organization's default currency when an amount is entered or changed.
  if new.est_cost_per_session is null and new.est_cost_per_participant is null then
    new.cost_currency := null;
  elsif v_costs_changed or new.cost_currency is null then
    new.cost_currency := (select s.currency_code from platform.tenant_settings s where s.tenant_id = new.tenant_id);
  end if;
  return new;
end
$$;

drop function private.course_library_actor(uuid, text, text);
