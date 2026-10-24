-- Which open planning cycles take part units of the structure (WP-HR-01; business flow
-- docs/business-flows/EP-ORG-structure-completion.md §3 B step 2 and §6, agreed by the PO 24 Oct 2026): the preview
-- of moving a unit warns when the unit, or a unit below it, is in an open planning cycle. Class: T. PII: none
-- (cycle names).
--
-- The HR Manager moves units (platform.org.manage) but reads no planning cycle: those reads need the planning
-- permissions (20261020210300, S-L3). So this one answer — the NAMES of the open cycles that include given units of
-- the caller's organization — comes from a SECURITY DEFINER function owned by a new role structure_guard
-- (NOLOGIN NOINHERIT NOBYPASSRLS, as the other guards): it reads three columns of tms.plan_cycles and two of
-- tms.plan_cycle_departments, of the caller's organization only (the organization of the verified claims), and
-- answers signed-in members only. The permission (platform.org.manage, the move preview) is the action's: members
-- never reach the database directly (ADR 0002: tenant schemas are not exposed; the app connects as app_server), and
-- the answer is the names of open cycles only. Platform service ↔ module data: a read of the module's
-- tables owned by a database role, never by platform code (the suite-ready rule applies to the application).
-- Expand-first: a new role and a new function; nothing calls it before the application does.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'structure_guard') then
    create role structure_guard nologin noinherit nobypassrls;
  end if;
end
$$;

do $$
declare
  r record;
begin
  select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolreplication, rolcreatedb, rolcreaterole
    into r from pg_roles where rolname = 'structure_guard';
  if r.rolsuper or r.rolbypassrls or r.rolreplication then
    raise exception 'role structure_guard must be NOSUPERUSER NOBYPASSRLS NOREPLICATION; fix it as a superuser first';
  end if;
  if r.rolinherit or r.rolcreatedb or r.rolcreaterole or r.rolcanlogin then
    alter role structure_guard nologin noinherit nocreatedb nocreaterole;
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
             where g.rolname = 'structure_guard' and (m.inherit_option or m.set_option)
               and not u.rolsuper and u.rolname <> current_user) then
    raise exception 'role structure_guard must have no members besides the migration role';
  end if;
end
$$;

grant structure_guard to current_user;
grant usage on schema private, tms to structure_guard;

-- What it reads (columns only) and the helpers it calls.
grant select (tenant_id, id, name_en, name_ar, status) on tms.plan_cycles to structure_guard;
grant select (tenant_id, cycle_id, department_id) on tms.plan_cycle_departments to structure_guard;
create policy plan_cycles_structure_guard_read on tms.plan_cycles for select to structure_guard using (true);
create policy plan_cycle_departments_structure_guard_read on tms.plan_cycle_departments for select
  to structure_guard using (true);
grant execute on function private.request_claims() to structure_guard;
grant execute on function private.current_tenant_id() to structure_guard;

create or replace function private.units_in_open_plan_cycles(p_unit_ids uuid[])
returns table (name_en text, name_ar text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
begin
  if v_tenant is null or p_unit_ids is null or cardinality(p_unit_ids) = 0
     or cardinality(p_unit_ids) > 2000
     or private.request_claims() ->> 'role' is distinct from 'authenticated' then
    return;
  end if;
  return query
    select distinct c.name_en, c.name_ar
    from tms.plan_cycles c
    join tms.plan_cycle_departments d on d.tenant_id = c.tenant_id and d.cycle_id = c.id
    where c.tenant_id = v_tenant and c.status = 'open' and d.department_id = any (p_unit_ids)
    order by c.name_en, c.name_ar;
end
$$;

comment on function private.units_in_open_plan_cycles(uuid[]) is
  'SECURITY-RELEVANT (WP-HR-01, EP-ORG addendum). Names of the open planning cycles of the caller''s organization that include any of the given units — signed-in members only; the move preview''s action requires platform.org.manage. Owner structure_guard.';

-- The new owner needs CREATE on the schema for the change of owner (hosted: a non-superuser migration role), only
-- for this statement.
grant create on schema private to structure_guard;
alter function private.units_in_open_plan_cycles(uuid[]) owner to structure_guard;
revoke create on schema private from structure_guard;
revoke all on function private.units_in_open_plan_cycles(uuid[]) from public;
grant execute on function private.units_in_open_plan_cycles(uuid[]) to authenticated;
