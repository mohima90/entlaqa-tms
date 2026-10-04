-- Where a person sits in the organization (FR-IAM-01 R1 subset, T-M2-02): branch, department, job
-- title, grade, direct manager, hire / end dates. One row per person (1:1). The direct manager feeds
-- the `direct_reports` / `reports_tree` scopes (ADR 0003) and the manager picker (screens
-- `docs/design/screens/m2-users-roles/`). Restricted HR attributes (FR-IAM-02) live elsewhere.
-- ADR 0002 §6 pattern. Class: T [std]. PII: job title, grade, manager link, dates (personal data).

create table platform.person_employment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  person_id uuid not null,
  branch_id uuid,
  department_id uuid,
  job_title_ar text,
  job_title_en text,
  grade text,
  manager_person_id uuid,
  hire_on date,
  end_on date,
  source text not null default 'manual',
  source_ref text,
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, person_id),
  constraint person_employment_job_title_check check (
    (job_title_ar is null or (char_length(job_title_ar) <= 150 and private.has_visible_text(job_title_ar)))
    and (job_title_en is null or (char_length(job_title_en) <= 150 and private.has_visible_text(job_title_en)))),
  constraint person_employment_grade_check check (grade is null or (char_length(grade) <= 40 and private.has_visible_text(grade))),
  constraint person_employment_manager_check check (manager_person_id is distinct from person_id),
  constraint person_employment_dates_check check (end_on is null or hire_on is null or end_on >= hire_on),
  constraint person_employment_source_check check (source in ('manual', 'import', 'hris', 'core_hr')),
  constraint person_employment_source_ref_check check (source_ref is null or char_length(source_ref) <= 200),
  foreign key (tenant_id, person_id) references platform.persons (tenant_id, id),
  foreign key (tenant_id, branch_id) references platform.branches (tenant_id, id),
  foreign key (tenant_id, department_id) references platform.departments (tenant_id, id),
  foreign key (tenant_id, manager_person_id) references platform.persons (tenant_id, id)
);
comment on table platform.person_employment is
  'Placement of a person: branch, department, job title, direct manager (FR-IAM-01). Owner: platform. Class: T [std].';

create index person_employment_tenant_manager_idx on platform.person_employment (tenant_id, manager_person_id)
  where manager_person_id is not null;
create index person_employment_tenant_department_idx on platform.person_employment (tenant_id, department_id)
  where department_id is not null;
create index person_employment_tenant_branch_idx on platform.person_employment (tenant_id, branch_id)
  where branch_id is not null;

-- References must point at live rows, and the manager chain must not loop:
--   * department / branch not soft-deleted; manager is an active person (checked when set or changed);
--   * no cycles in the manager chain (A → B → A), at most 50 levels.
-- Locks (READ COMMITTED; same keys as private.check_tree, always in the order departments → branches →
-- person_employment) serialise these checks against concurrent soft deletes and manager changes.
-- SECURITY INVOKER: sees the caller's tenant only (read policies are tenant-wide).
create or replace function private.check_person_employment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_dept_changed boolean := new.department_id is not null
    and (tg_op = 'INSERT' or new.department_id is distinct from old.department_id);
  v_branch_changed boolean := new.branch_id is not null
    and (tg_op = 'INSERT' or new.branch_id is distinct from old.branch_id);
  v_manager_changed boolean := new.manager_person_id is not null
    and (tg_op = 'INSERT' or new.manager_person_id is distinct from old.manager_person_id);
  v_cycle boolean;
begin
  if v_dept_changed then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('platform.departments:' || new.tenant_id::text, 0));
    if exists (select 1 from platform.departments d
               where d.tenant_id = new.tenant_id and d.id = new.department_id and d.deleted_at is not null) then
      raise exception 'a person cannot be placed in a deleted department' using errcode = 'check_violation';
    end if;
  end if;
  if v_branch_changed then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('platform.branches:' || new.tenant_id::text, 0));
    if exists (select 1 from platform.branches b
               where b.tenant_id = new.tenant_id and b.id = new.branch_id and b.deleted_at is not null) then
      raise exception 'a person cannot be placed in a deleted branch' using errcode = 'check_violation';
    end if;
  end if;
  if v_manager_changed and new.manager_person_id is distinct from new.person_id then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('platform.person_employment:' || new.tenant_id::text, 0));
    if not exists (select 1 from platform.persons p
                   where p.tenant_id = new.tenant_id and p.id = new.manager_person_id and p.status = 'active') then
      raise exception 'the direct manager must be an active person' using errcode = 'check_violation';
    end if;
    with recursive chain (person_id, depth, cycle) as (
      select e.manager_person_id, 1, e.manager_person_id = new.person_id
      from platform.person_employment e
      where e.tenant_id = new.tenant_id and e.person_id = new.manager_person_id and e.manager_person_id is not null
      union all
      select e.manager_person_id, c.depth + 1, e.manager_person_id = new.person_id
      from chain c
      join platform.person_employment e on e.tenant_id = new.tenant_id and e.person_id = c.person_id
      where not c.cycle and c.depth < 60 and e.manager_person_id is not null
    )
    select coalesce(bool_or(cycle), false) or coalesce(max(depth), 0) >= 50 into v_cycle from chain;
    if v_cycle then
      raise exception 'the manager chain of person % would loop or exceed 50 levels', new.person_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

comment on function private.check_person_employment() is
  'Live references and an acyclic manager chain for platform.person_employment. SECURITY INVOKER; serialised per tenant.';

revoke all on function private.check_person_employment() from public;

create trigger person_employment_stamp_row before insert or update on platform.person_employment
  for each row execute function private.stamp_row();
create trigger person_employment_validate before insert or update of department_id, branch_id, manager_person_id
  on platform.person_employment
  for each row execute function private.check_person_employment();

-- A department or branch cannot be soft-deleted while ACTIVE people are still placed in it (they are
-- moved first; deactivated people keep their last placement as history). Moving people is part of the
-- reorganisation and deactivation flows (FR-IAM-05). The delete already holds the departments /
-- branches lock taken by private.check_tree().
create or replace function private.check_org_unit_has_no_people()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null and exists (
       select 1 from platform.person_employment e
       join platform.persons p on p.tenant_id = e.tenant_id and p.id = e.person_id
       where e.tenant_id = new.tenant_id and p.status = 'active'
         and case tg_table_name when 'departments' then e.department_id else e.branch_id end = new.id) then
    raise exception '%.% row % still has active people placed in it', tg_table_schema, tg_table_name, new.id
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function private.check_org_unit_has_no_people() from public;

-- Names sort after "*_soft_delete" and "*_tree" (the tree trigger takes the lock first).
create trigger departments_until_people_moved before update of deleted_at on platform.departments
  for each row execute function private.check_org_unit_has_no_people();
create trigger branches_until_people_moved before update of deleted_at on platform.branches
  for each row execute function private.check_org_unit_has_no_people();

alter table platform.person_employment enable row level security;
alter table platform.person_employment force row level security;

create policy tenant_isolation on platform.person_employment
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Fine-grained permissions (platform.person.*) are enforced server-side by defineAction (ADR 0003 §4).
create policy person_employment_read on platform.person_employment for select to authenticated using (true);
create policy person_employment_insert on platform.person_employment for insert to authenticated with check (true);
create policy person_employment_update on platform.person_employment for update to authenticated using (true) with check (true);

-- One row per person for the person's lifetime: no DELETE grant (end_on records leaving).
revoke all on platform.person_employment from public, anon;
grant select, insert, update on platform.person_employment to authenticated;
