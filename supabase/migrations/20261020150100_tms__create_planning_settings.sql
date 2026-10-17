-- Planning settings of an organization (EP-PLN step A3; FR-PLN-02, FR-WFL-01/02 R1 part; BACKLOG T-M3-04).
-- ADR 0002 §6 pattern. Class: T [std]. PII: approver_person_id (person reference only).
--
--   tms.planning_settings       one row per organization (created on the first save): the default reminder
--                               days before a cycle's deadline (default 7 and 2 — business flow §3 A3).
--   tms.planning_default_steps  the default approval chain a new cycle copies (business flow §3 A3, §3 B4):
--                               ordered steps, each either the built-in «Department Heads» step (every head
--                               confirms their own lines in parallel — PO 17 Oct 2026, FR-WFL-02 R1 part; at
--                               most one) or a NAMED person step (Finance approver, management approver…;
--                               EP-ROLES Q4: a named person per step, no role needed). A person step may leave
--                               the person empty here; the cycle names them before launch.
-- Without rows the application uses the built-in defaults (modules/tms planning model): reminders 7 and 2,
-- chain Department Heads → Finance approval → Management approval.
--
-- Rules (defence in depth; the application checks them first with field errors):
--   * reads: any member of the organization (row-level security limits to the tenant; the pages and actions
--     require tms.plan_cycle.read / .manage — ADR 0003 §4);
--   * writes: members holding tms.plan_cycle.manage organization-wide (the L&D Manager) only;
--   * BR-PLN-g: one person cannot be the approver of two steps of the chain (unique index);
--   * reminder days: up to 5 distinct whole days between 1 and 90.

-- Up to 5 distinct reminder days, each 1–90 (also used by tms.plan_cycles, migration 20261020150200).
create or replace function private.plan_reminder_days_valid(p_days smallint[])
returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select p_days is not null
     and cardinality(p_days) <= 5
     and array_position(p_days, null) is null
     and not exists (select 1 from unnest(p_days) d where d < 1 or d > 90)
     and (select count(distinct d) from unnest(p_days) d) = cardinality(p_days);
$$;

comment on function private.plan_reminder_days_valid(smallint[]) is
  'Reminder days of a planning cycle or of the planning settings: up to 5 distinct whole days, 1–90 (EP-PLN).';

revoke all on function private.plan_reminder_days_valid(smallint[]) from public;
grant execute on function private.plan_reminder_days_valid(smallint[]) to authenticated;

-- Does the signed-in member hold tms.plan_cycle.manage organization-wide in this organization? (EP-ROLES
-- permission helpers: standard and custom roles.) SECURITY INVOKER: the caller's row-level security applies.
create or replace function private.may_manage_plan_cycles(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.member_has_permission(p_tenant_id, private.request_user_id(), 'tms.plan_cycle.manage');
$$;

comment on function private.may_manage_plan_cycles(uuid) is
  'SECURITY-RELEVANT (EP-PLN, ADR 0003 §5). The signed-in member holds tms.plan_cycle.manage organization-wide.';

revoke all on function private.may_manage_plan_cycles(uuid) from public;
grant execute on function private.may_manage_plan_cycles(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- tms.planning_settings
-- ---------------------------------------------------------------------------------------------------
create table tms.planning_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  reminder_days smallint[] not null default '{7,2}'
    constraint planning_settings_reminder_days_check check (private.plan_reminder_days_valid(reminder_days)),
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  constraint planning_settings_tenant_uq unique (tenant_id)
);
comment on table tms.planning_settings is
  'Planning settings of an organization: default reminder days (EP-PLN A3, FR-PLN-02). Owner: tms. Class: T [std].';

create trigger planning_settings_stamp_row before insert or update on tms.planning_settings
  for each row execute function private.stamp_row();

alter table tms.planning_settings enable row level security;
alter table tms.planning_settings force row level security;

create policy tenant_isolation on tms.planning_settings
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy planning_settings_read on tms.planning_settings for select to authenticated using (true);
create policy planning_settings_insert on tms.planning_settings for insert to authenticated
  with check (private.may_manage_plan_cycles(tenant_id));
create policy planning_settings_update on tms.planning_settings for update to authenticated
  using (private.may_manage_plan_cycles(tenant_id)) with check (private.may_manage_plan_cycles(tenant_id));

-- No DELETE: the settings change, they are not removed.
revoke all on tms.planning_settings from public, anon;
grant select on tms.planning_settings to authenticated;
grant insert (tenant_id, reminder_days) on tms.planning_settings to authenticated;
grant update (reminder_days) on tms.planning_settings to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- tms.planning_default_steps
-- ---------------------------------------------------------------------------------------------------
create table tms.planning_default_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  position smallint not null
    constraint planning_default_steps_position_check check (position between 1 and 10),
  kind text not null
    constraint planning_default_steps_kind_check check (kind in ('department_heads', 'person')),
  name_ar text not null
    constraint planning_default_steps_name_ar_check check (
      name_ar = btrim(name_ar) and char_length(name_ar) between 1 and 80 and private.has_visible_text(name_ar)),
  name_en text not null
    constraint planning_default_steps_name_en_check check (
      name_en = btrim(name_en) and char_length(name_en) between 1 and 80 and private.has_visible_text(name_en)),
  approver_person_id uuid,
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  constraint planning_default_steps_position_uq unique (tenant_id, position),
  -- The built-in Department Heads step names nobody (each head confirms their own lines).
  constraint planning_default_steps_approver_check check (kind = 'person' or approver_person_id is null),
  foreign key (tenant_id, approver_person_id) references platform.persons (tenant_id, id)
);
comment on table tms.planning_default_steps is
  'Default approval chain of the organization''s planning cycles (EP-PLN A3, FR-WFL-01/02 R1 part). Owner: tms. Class: T [std].';

-- At most one built-in Department Heads step; BR-PLN-g: one person approves at most one step.
create unique index planning_default_steps_department_heads_uq on tms.planning_default_steps (tenant_id)
  where kind = 'department_heads';
-- (Also the index of the composite person foreign key.)
create unique index planning_default_steps_approver_uq on tms.planning_default_steps (tenant_id, approver_person_id)
  where approver_person_id is not null;

create trigger planning_default_steps_stamp_row before insert or update on tms.planning_default_steps
  for each row execute function private.stamp_row();

alter table tms.planning_default_steps enable row level security;
alter table tms.planning_default_steps force row level security;

create policy tenant_isolation on tms.planning_default_steps
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy planning_default_steps_read on tms.planning_default_steps for select to authenticated using (true);
create policy planning_default_steps_insert on tms.planning_default_steps for insert to authenticated
  with check (private.may_manage_plan_cycles(tenant_id));
create policy planning_default_steps_update on tms.planning_default_steps for update to authenticated
  using (private.may_manage_plan_cycles(tenant_id)) with check (private.may_manage_plan_cycles(tenant_id));
create policy planning_default_steps_delete on tms.planning_default_steps for delete to authenticated
  using (private.may_manage_plan_cycles(tenant_id));

-- The chain is saved as a whole (delete + insert in one transaction).
revoke all on tms.planning_default_steps from public, anon;
grant select, delete on tms.planning_default_steps to authenticated;
grant insert (tenant_id, position, kind, name_ar, name_en, approver_person_id) on tms.planning_default_steps to authenticated;
grant update (position, kind, name_ar, name_en, approver_person_id) on tms.planning_default_steps to authenticated;
