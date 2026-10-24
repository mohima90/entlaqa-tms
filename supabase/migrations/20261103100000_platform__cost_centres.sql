-- Cost centres (WP-HR-01; FR-ADM-05 cost center, FR-FIN-03; business flow
-- docs/business-flows/EP-ORG-structure-completion.md §3 A, agreed by the PO 24 Oct 2026: "cost centres belong to the
-- person", as SAP SuccessFactors, Cornerstone and Workday do). Class: T [std]. PII: none (finance codes and names).
--
--   platform.cost_centres                       the organization's finance codes («CC-4100 Riyadh Sales»): code,
--                                               English and Arabic name (at least one), active / inactive. Kept by
--                                               the HR Manager (platform.org.manage, like the rest of the
--                                               structure). A cost centre in use cannot be deleted
--                                               (foreign keys), only deactivated.
--   platform.person_employment.cost_centre_id   the person's ONE cost centre (no split by percentage, PO 24 Oct
--                                               2026). Written with the placement (platform.user.update, as the
--                                               rest of person_employment: private.check_person_writer).
--   platform.departments.default_cost_centre_id what a person placed in the unit gets when HR picks none
--                                               (filled by the database on insert / placement change while the
--                                               person has none; changing a unit's default later changes nobody).
-- Rules (every writer; the application checks them first):
--   * a cost centre picked for a person or as a unit's default is active (when set or changed);
--   * codes are unique in the organization, case-insensitive, letters / digits / . _ - (as unit codes).
-- Audit: the actions write platform.org.cost_centre_added / _changed / _deleted (before/after); a person's cost
-- centre is part of the person-changed audit; a unit's default of the unit-changed audit.
-- Expand-first: the running application writes none of the new columns.

create table platform.cost_centres (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  code text not null,
  name_en text,
  name_ar text,
  status text not null default 'active',
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  constraint cost_centres_code_check check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  constraint cost_centres_name_check check (num_nonnulls(name_en, name_ar) >= 1),
  constraint cost_centres_name_en_check check (name_en is null or (
    name_en = btrim(name_en) and char_length(name_en) between 1 and 120 and private.has_visible_text(name_en))),
  constraint cost_centres_name_ar_check check (name_ar is null or (
    name_ar = btrim(name_ar) and char_length(name_ar) between 1 and 120 and private.has_visible_text(name_ar))),
  constraint cost_centres_status_check check (status in ('active', 'inactive'))
);
comment on table platform.cost_centres is
  'Cost centres of an organization: the finance codes that pay (FR-ADM-05, FR-FIN-03; EP-ORG addendum WP-HR-01). Owner: platform. Class: T [std].';

create unique index cost_centres_tenant_code_uq on platform.cost_centres (tenant_id, lower(code));

create trigger cost_centres_stamp_row before insert or update on platform.cost_centres
  for each row execute function private.stamp_row();

alter table platform.cost_centres enable row level security;
alter table platform.cost_centres force row level security;

create policy tenant_isolation on platform.cost_centres
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Every member reads them (a person's and a unit's cost centre are shown with their names).
create policy cost_centres_read on platform.cost_centres for select to authenticated using (true);
-- Writes: platform.org.manage organization-wide (the HR Manager), as units and branches (20261020210000).
create policy cost_centres_insert on platform.cost_centres for insert to authenticated
  with check (private.actor_may_manage_structure(tenant_id));
create policy cost_centres_update on platform.cost_centres for update to authenticated
  using (private.actor_may_manage_structure(tenant_id))
  with check (private.actor_may_manage_structure(tenant_id));
create policy cost_centres_delete on platform.cost_centres for delete to authenticated
  using (private.actor_may_manage_structure(tenant_id));

revoke all on platform.cost_centres from public, anon;
grant select, delete on platform.cost_centres to authenticated;
grant insert (code, name_en, name_ar, status) on platform.cost_centres to authenticated;
grant update (code, name_en, name_ar, status) on platform.cost_centres to authenticated;

-- A person's cost centre and a unit's default.
alter table platform.person_employment
  add column cost_centre_id uuid,
  add constraint person_employment_cost_centre_fkey
    foreign key (tenant_id, cost_centre_id) references platform.cost_centres (tenant_id, id);
comment on column platform.person_employment.cost_centre_id is
  'The person''s one cost centre (WP-HR-01). Filled from the unit''s default when HR picks none.';
create index person_employment_tenant_cost_centre_idx on platform.person_employment (tenant_id, cost_centre_id)
  where cost_centre_id is not null;

alter table platform.departments
  add column default_cost_centre_id uuid,
  add constraint departments_default_cost_centre_fkey
    foreign key (tenant_id, default_cost_centre_id) references platform.cost_centres (tenant_id, id);
comment on column platform.departments.default_cost_centre_id is
  'The cost centre a person placed in this unit gets when HR picks none (WP-HR-01).';
create index departments_tenant_default_cost_centre_idx on platform.departments (tenant_id, default_cost_centre_id)
  where default_cost_centre_id is not null;

grant update (cost_centre_id) on platform.person_employment to authenticated;

-- A cost centre picked (set or changed) is active. SECURITY INVOKER: the caller's organization's rows (read
-- policy organization-wide).
create or replace function private.check_cost_centre_ref()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- The column by name: the record of one table has no field of the other.
  v_column constant text := case tg_table_name when 'departments' then 'default_cost_centre_id' else 'cost_centre_id' end;
  v_new uuid := (to_jsonb(new) ->> v_column)::uuid;
  v_old uuid;
begin
  if tg_op = 'UPDATE' then
    v_old := (to_jsonb(old) ->> v_column)::uuid;
  end if;
  if v_new is not null and (tg_op = 'INSERT' or v_new is distinct from v_old)
     and not exists (select 1 from platform.cost_centres c
                     where c.tenant_id = new.tenant_id and c.id = v_new and c.status = 'active') then
    raise exception 'the cost centre must be active' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

comment on function private.check_cost_centre_ref() is
  'A cost centre picked for a person or as a unit''s default is active (WP-HR-01).';

revoke all on function private.check_cost_centre_ref() from public;

create trigger departments_validate_cost_centre before insert or update of default_cost_centre_id on platform.departments
  for each row execute function private.check_cost_centre_ref();

-- A person placed in a unit without a cost centre gets the unit's default (insert, or a new unit while they
-- have none). Runs after the writer guard and before the reference check (name order), so the default is
-- checked too.
create or replace function private.fill_person_cost_centre()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.cost_centre_id is null and new.department_id is not null
     and (tg_op = 'INSERT' or new.department_id is distinct from old.department_id) then
    select d.default_cost_centre_id into new.cost_centre_id
    from platform.departments d
    join platform.cost_centres c on c.tenant_id = d.tenant_id and c.id = d.default_cost_centre_id
    where d.tenant_id = new.tenant_id and d.id = new.department_id and c.status = 'active';
  end if;
  return new;
end
$$;

comment on function private.fill_person_cost_centre() is
  'A person placed in a unit without a cost centre gets the unit''s active default (WP-HR-01).';

revoke all on function private.fill_person_cost_centre() from public;

create trigger person_employment_validate_cost_centre_1_default before insert or update of department_id, cost_centre_id
  on platform.person_employment
  for each row execute function private.fill_person_cost_centre();
create trigger person_employment_validate_cost_centre_2_ref before insert or update of department_id, cost_centre_id
  on platform.person_employment
  for each row execute function private.check_cost_centre_ref();
