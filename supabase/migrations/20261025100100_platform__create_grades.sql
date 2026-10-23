-- Grades (WP-ADM-04, FR-IAM-01 grade; business flow docs/business-flows/EP-PEOPLE-photo-hr-fields.md, PO
-- answers 21 Oct 2026 #2-#3 and 23 Oct 2026 #2-#4). ADR 0002 §6 pattern. Class: T [std]. PII: none in the
-- list itself (grade codes); WHO holds a grade is personal data (platform.person_grades, pii:indirect).
--
--   platform.grades          the organization's list of grade codes, e.g. 7, G7, #7, G-7. A code is unique in
--                            the organization (case-insensitively: g7 and G7 are the same grade), 1-12
--                            characters without spaces or invisible marks, with at least one character that is
--                            not punctuation (letters, digits and punctuation are all allowed; PO 23 Oct 2026
--                            #3). Many people share a grade.
--   platform.person_grades   the grade of a person (at most one row per person; no row = no grade). Kept apart
--                            from platform.person_employment on purpose: the HR Manager sets the grade of a
--                            privileged member too (BR-PPL-f), which the guard of the placement row refuses,
--                            and who may SEE a grade is narrower than who sees the placement (below).
--                            The older free-text column person_employment.grade stays, unused (expand-first).
--
-- Who does what — in the DATABASE:
--   * the list is changed (add, rename, delete) by a signed-in member who holds platform.user.update
--     organization-wide — the HR Manager and the Organization Admin (PO 23 Oct 2026 #4); every member reads
--     the codes (a select list, no personal data); system jobs never change it;
--   * a person's grade is set and cleared by the same members, also for a privileged member;
--   * a person's grade is READ by the person, those same members, their managers (anyone above them in the
--     manager chain) and the heads of their unit and of the units above it (PO 23 Oct 2026 #2) — nobody else:
--     not the L&D Manager, not other colleagues.
--   * a grade people still hold is not deleted (JG001, with the number of people in the message; the foreign
--     key says the same); a rename keeps the people on it (they show the new code).
-- Audit: the actions write platform.grade.created / renamed / deleted (codes only) and
-- platform.person.grade_changed (person; from and to codes).

create table platform.grades (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  code text not null,
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  constraint grades_code_check check (
    code = btrim(code)
    and char_length(code) between 1 and 12
    -- no spaces, control characters or invisible / formatting marks (the list written by
    -- private.has_visible_text, as escapes: no invisible character in this file)
    and code !~ '[[:space:][:cntrl:] ­͏؜ᅟᅠ឴឵᠋-᠏​-‏ -  -⁯　ㅤ︀-️﻿ﾠ⠀￼]'
    -- at least one letter or digit (a code of punctuation only says nothing)
    and code ~ '[^[:punct:]]')
);
comment on table platform.grades is
  'The organization''s grade codes (FR-IAM-01, WP-ADM-04): unique per organization, many people per grade. Owner: platform. Class: T [std].';

create unique index grades_tenant_code_uq on platform.grades (tenant_id, lower(code));

create table platform.person_grades (
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  person_id uuid not null,
  grade_id uuid not null,
  -- [std] without id (one row per person).
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  primary key (tenant_id, person_id),
  constraint person_grades_person_fkey foreign key (tenant_id, person_id)
    references platform.persons (tenant_id, id),
  constraint person_grades_grade_fkey foreign key (tenant_id, grade_id)
    references platform.grades (tenant_id, id)
);
comment on table platform.person_grades is
  'The grade of a person (FR-IAM-01, WP-ADM-04): set by HR / the Organization Admin; read by the person, them and the person''s managers and unit heads. Owner: platform. Class: T [std].';
comment on column platform.person_grades.grade_id is 'pii:indirect';
create index person_grades_tenant_grade_idx on platform.person_grades (tenant_id, grade_id);

comment on column platform.person_employment.grade is
  'Superseded by platform.person_grades (WP-ADM-04): never read or written by the application.';

-- Who changes the list and the grades of people: platform.user.update organization-wide, signed-in member.
create or replace function private.actor_may_manage_grades(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.request_claims() ->> 'role' = 'authenticated'
         and private.member_has_permission(p_tenant_id, private.request_user_id(), 'platform.user.update');
$$;
comment on function private.actor_may_manage_grades(uuid) is
  'SECURITY-RELEVANT (WP-ADM-04). A signed-in member holding platform.user.update organization-wide (HR Manager, Organization Admin): changes the grade list and the grades of people.';
revoke all on function private.actor_may_manage_grades(uuid) from public;
grant execute on function private.actor_may_manage_grades(uuid) to authenticated;

-- Who sees a person's grade: the person, the managers of grades, anyone above the person in the manager chain
-- and the head of the person's unit or of a unit above it. SECURITY INVOKER: the tables it reads are readable
-- by every member of the organization; the answer is for the claims' person.
create or replace function private.actor_sees_grade_of(p_tenant_id uuid, p_person_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.request_claims() ->> 'role' = 'authenticated'
         and private.request_person_id() is not null
         and (
           p_person_id = private.request_person_id()
           or private.actor_may_manage_grades(p_tenant_id)
           or exists (
             with recursive chain (manager_id, depth) as (
               select e.manager_person_id, 1 from platform.person_employment e
               where e.tenant_id = p_tenant_id and e.person_id = p_person_id and e.manager_person_id is not null
               union all
               select e.manager_person_id, c.depth + 1 from chain c
               join platform.person_employment e on e.tenant_id = p_tenant_id and e.person_id = c.manager_id
               where e.manager_person_id is not null and c.depth < 60
             )
             select 1 from chain where manager_id = private.request_person_id())
           or exists (
             with recursive up (unit_id, depth) as (
               select e.department_id, 1 from platform.person_employment e
               where e.tenant_id = p_tenant_id and e.person_id = p_person_id and e.department_id is not null
               union all
               select d.parent_id, u.depth + 1 from up u
               join platform.departments d on d.tenant_id = p_tenant_id and d.id = u.unit_id
               where d.parent_id is not null and u.depth < 20
             )
             select 1 from up
             join platform.departments h on h.tenant_id = p_tenant_id and h.id = up.unit_id
             where h.head_person_id = private.request_person_id() and h.deleted_at is null)
         );
$$;
comment on function private.actor_sees_grade_of(uuid, uuid) is
  'SECURITY-RELEVANT (WP-ADM-04, PO 23 Oct 2026 #2). True for the person, members who manage grades (HR, Organization Admin), anyone above the person in the manager chain and the heads of the person''s unit and the units above it.';
revoke all on function private.actor_sees_grade_of(uuid, uuid) from public;
grant execute on function private.actor_sees_grade_of(uuid, uuid) to authenticated;

-- [std] stamps; identity immutable.
create or replace function private.stamp_person_grade()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := new.created_at;
    new.created_by := private.request_person_id();
    new.updated_by := new.created_by;
    new.version := 1;
    return new;
  end if;
  if (new.tenant_id, new.person_id) is distinct from (old.tenant_id, old.person_id) then
    raise exception 'the person of a grade assignment cannot change' using errcode = 'insufficient_privilege';
  end if;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.updated_at := now();
  new.updated_by := private.request_person_id();
  new.version := old.version + 1;
  return new;
end
$$;
comment on function private.stamp_person_grade() is
  'SECURITY-RELEVANT (WP-ADM-04). Stamps created_*/updated_*/version of a grade assignment from verified claims.';
revoke all on function private.stamp_person_grade() from public;

create trigger person_grades_stamp before insert or update on platform.person_grades
  for each row execute function private.stamp_person_grade();

-- A grade people still hold is not deleted (names how many); the identity of a grade never changes.
create or replace function private.check_grade()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_people bigint;
begin
  if tg_op = 'DELETE' then
    select count(*) into v_people from platform.person_grades g
    where g.tenant_id = old.tenant_id and g.grade_id = old.id;
    if v_people > 0 then
      raise exception 'grade % is held by % person(s)', old.id, v_people using errcode = 'JG001';
    end if;
    return old;
  end if;
  if (new.id, new.tenant_id) is distinct from (old.id, old.tenant_id) then
    raise exception 'the identity of a grade cannot change' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
comment on function private.check_grade() is
  'SECURITY-RELEVANT (WP-ADM-04). A grade people still hold is not deleted (JG001); identity immutable.';
revoke all on function private.check_grade() from public;

create trigger grades_guard before update or delete on platform.grades
  for each row execute function private.check_grade();
create trigger grades_stamp_row before insert or update on platform.grades
  for each row execute function private.stamp_row();

alter table platform.grades enable row level security;
alter table platform.grades force row level security;

create policy tenant_isolation on platform.grades
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy grades_read on platform.grades for select to authenticated using (true);
create policy grades_insert on platform.grades for insert to authenticated
  with check (private.actor_may_manage_grades(tenant_id));
create policy grades_update on platform.grades for update to authenticated
  using (private.actor_may_manage_grades(tenant_id))
  with check (private.actor_may_manage_grades(tenant_id));
create policy grades_delete on platform.grades for delete to authenticated
  using (private.actor_may_manage_grades(tenant_id));

revoke all on platform.grades from public, anon;
grant select, delete on platform.grades to authenticated;
grant insert (code) on platform.grades to authenticated;
grant update (code) on platform.grades to authenticated;

alter table platform.person_grades enable row level security;
alter table platform.person_grades force row level security;

create policy tenant_isolation on platform.person_grades
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy person_grades_read on platform.person_grades for select to authenticated
  using (private.actor_sees_grade_of(tenant_id, person_id));
create policy person_grades_insert on platform.person_grades for insert to authenticated
  with check (private.actor_may_manage_grades(tenant_id));
create policy person_grades_update on platform.person_grades for update to authenticated
  using (private.actor_may_manage_grades(tenant_id))
  with check (private.actor_may_manage_grades(tenant_id));
create policy person_grades_delete on platform.person_grades for delete to authenticated
  using (private.actor_may_manage_grades(tenant_id));

revoke all on platform.person_grades from public, anon;
grant select, delete on platform.person_grades to authenticated;
grant insert (person_id, grade_id) on platform.person_grades to authenticated;
grant update (grade_id) on platform.person_grades to authenticated;
