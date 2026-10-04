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
  constraint departments_name_ar_check check (length(btrim(name_ar)) between 1 and 200),
  constraint departments_name_en_check check (name_en is null or length(btrim(name_en)) between 1 and 200),
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

create trigger departments_stamp_row before insert or update on platform.departments
  for each row execute function private.stamp_row();

-- The hierarchy must stay a tree: a department cannot become its own ancestor, and depth is bounded so
-- subtree queries stay cheap. SECURITY INVOKER: walks only rows the caller can see (its own tenant).
create or replace function private.check_department_hierarchy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_depth integer;
  v_cycle boolean;
  v_below integer := 0;
begin
  if new.parent_id is null then
    return new;
  end if;
  -- Levels below the moved department (its subtree moves with it).
  if tg_op = 'UPDATE' then
    with recursive descendants (id, depth) as (
      select d.id, 1
      from platform.departments d
      where d.tenant_id = new.tenant_id and d.parent_id = new.id
      union all
      select d.id, s.depth + 1
      from descendants s
      join platform.departments d on d.tenant_id = new.tenant_id and d.parent_id = s.id
      where s.depth < 20
    )
    select coalesce(max(depth), 0) into v_below from descendants;
  end if;
  with recursive ancestors (id, parent_id, depth, cycle) as (
    select d.id, d.parent_id, 1, d.id = new.id
    from platform.departments d
    where d.tenant_id = new.tenant_id and d.id = new.parent_id
    union all
    select d.id, d.parent_id, a.depth + 1, d.id = new.id
    from ancestors a
    join platform.departments d on d.tenant_id = new.tenant_id and d.id = a.parent_id
    where not a.cycle and a.depth < 20
  )
  select max(depth), bool_or(cycle) into v_depth, v_cycle from ancestors;
  if v_cycle then
    raise exception 'department % cannot be placed under its own descendant', new.id
      using errcode = 'check_violation';
  end if;
  -- v_depth ancestors + the department itself + v_below levels under it.
  if v_depth + 1 + v_below > 10 then
    raise exception 'department hierarchy is limited to 10 levels'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

comment on function private.check_department_hierarchy() is
  'Keeps platform.departments a tree (no cycles, at most 10 levels). SECURITY INVOKER.';

revoke all on function private.check_department_hierarchy() from public;

create trigger departments_hierarchy before insert or update of parent_id on platform.departments
  for each row execute function private.check_department_hierarchy();

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

-- [sd]: no DELETE grant; "delete" sets deleted_at / deleted_by.
revoke all on platform.departments from public, anon;
grant select, insert, update on platform.departments to authenticated;
