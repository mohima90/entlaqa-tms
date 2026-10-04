-- Departments of an organization (الأقسام), hierarchical, with an optional head and home branch.
-- Features: ADM-05 (subset needed by users & roles, T-M2-01); cost centers and the materialized `path`
-- used by subtree scopes (ADR 0003 `org_units`) are added with EP-M2-TEN / the scope work.
-- ADR 0002 §6 pattern. Class: T [std][sd]. PII: head_person_id (person reference only).

create table platform.departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  code text not null,
  name_ar text not null,
  name_en text,
  parent_id uuid,
  branch_id uuid,
  head_person_id uuid,
  sort_order integer not null default 0,
  status text not null default 'active',
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  -- [sd]
  deleted_at timestamptz,
  deleted_by uuid,
  unique (tenant_id, id),
  constraint departments_code_check check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  -- Names need at least one visible character (not only spaces, tabs, line breaks or invisible marks).
  constraint departments_name_ar_check check (
    char_length(name_ar) <= 200 and name_ar ~ '[^[:space:] ​-‏  ⁠﻿]'),
  constraint departments_name_en_check check (name_en is null or (
    char_length(name_en) <= 200 and name_en ~ '[^[:space:] ​-‏  ⁠﻿]')),
  constraint departments_status_check check (status in ('active', 'inactive')),
  constraint departments_parent_check check (parent_id is distinct from id),
  constraint departments_deleted_check check (deleted_by is null or deleted_at is not null),
  foreign key (tenant_id, parent_id) references platform.departments (tenant_id, id),
  foreign key (tenant_id, branch_id) references platform.branches (tenant_id, id),
  foreign key (tenant_id, head_person_id) references platform.persons (tenant_id, id)
);
comment on table platform.departments is 'Departments of an organization (ADM-05). Owner: platform. Class: T [std][sd].';

create unique index departments_tenant_code_uq on platform.departments (tenant_id, lower(code)) where deleted_at is null;
create index departments_tenant_parent_idx on platform.departments (tenant_id, parent_id) where parent_id is not null;
create index departments_tenant_branch_idx on platform.departments (tenant_id, branch_id) where branch_id is not null;
create index departments_tenant_head_idx on platform.departments (tenant_id, head_person_id) where head_person_id is not null;

-- References from a department must point at live rows: the branch is not soft-deleted and the head is
-- an active person. Checked when the reference is set or changed, or when the department is restored.
-- SECURITY INVOKER (same-tenant rows only).
create or replace function private.check_department_refs()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_restoring boolean := tg_op = 'UPDATE' and old.deleted_at is not null and new.deleted_at is null;
begin
  if new.deleted_at is not null then
    return new;
  end if;
  if new.branch_id is not null
     and (tg_op = 'INSERT' or v_restoring or new.branch_id is distinct from old.branch_id)
     and exists (select 1 from platform.branches b
                 where b.tenant_id = new.tenant_id and b.id = new.branch_id and b.deleted_at is not null) then
    raise exception 'department % cannot belong to a deleted branch', new.id using errcode = 'check_violation';
  end if;
  if new.head_person_id is not null
     and (tg_op = 'INSERT' or v_restoring or new.head_person_id is distinct from old.head_person_id)
     and not exists (select 1 from platform.persons p
                     where p.tenant_id = new.tenant_id and p.id = new.head_person_id and p.status = 'active') then
    raise exception 'the head of department % must be an active person', new.id using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function private.check_department_refs() from public;

-- Triggers fire in name order: *_soft_delete normalises deleted_* before *_tree and *_validate_refs
-- read them (keep those names sorting after "soft_delete").
create trigger departments_soft_delete before insert or update on platform.departments
  for each row execute function private.stamp_soft_delete();
create trigger departments_stamp_row before insert or update on platform.departments
  for each row execute function private.stamp_row();
create trigger departments_tree before insert or update of parent_id, deleted_at on platform.departments
  for each row execute function private.check_tree('parent_id', '10');
create trigger departments_validate_refs before insert or update of branch_id, head_person_id, deleted_at
  on platform.departments
  for each row execute function private.check_department_refs();

-- A branch cannot be soft-deleted while departments that are not deleted still belong to it.
create or replace function private.check_branch_in_use()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null
     and exists (select 1 from platform.departments d
                 where d.tenant_id = new.tenant_id and d.branch_id = new.id and d.deleted_at is null) then
    raise exception 'branch % still has departments that are not deleted', new.id using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function private.check_branch_in_use() from public;

create trigger branches_until_departments_moved before update of deleted_at on platform.branches
  for each row execute function private.check_branch_in_use();

alter table platform.departments enable row level security;
alter table platform.departments force row level security;

create policy tenant_isolation on platform.departments
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Fine-grained permissions (platform.org.*) are enforced server-side by defineAction (ADR 0003 §4).
create policy departments_read on platform.departments for select to authenticated using (true);
create policy departments_insert on platform.departments for insert to authenticated with check (true);
create policy departments_update on platform.departments for update to authenticated using (true) with check (true);

-- [sd]: no DELETE grant; "delete" sets deleted_at (the trigger records when and by whom).
revoke all on platform.departments from public, anon;
grant select, insert, update on platform.departments to authenticated;
