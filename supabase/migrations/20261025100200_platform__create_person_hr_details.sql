-- HR-only person fields (WP-ADM-04, FR-IAM-02; business flow docs/business-flows/EP-PEOPLE-photo-hr-fields.md
-- BR-PPL-e..i, PO answers 21 Oct 2026 #1/#4/#5/#9). ADR 0002 §6 pattern. Class: T. PII: gender, date of birth
-- and employment category are personal data and may be sensitive (security decision 13: legal counsel decides
-- before the first customer) — classified pii:sensitive.
--
--   platform.person_hr_details   at most one row per person: gender (male / female), date of birth,
--                                employment category (management / professional / technical / operational —
--                                the fixed four of R1; each organization's own list comes with custom fields,
--                                WP-ADM-07). All optional. The grade is NOT here: it is not HR-only
--                                (platform.grades, 20261025100100).
--
-- Who reads and writes it — in the DATABASE, not only in the application (the row never reaches anyone else):
--   * read: the person themself (their own row, read-only) and members holding platform.person.hr_details
--     organization-wide (the HR Manager; a custom role with the permission). The Organization Admin does not
--     hold it (PO answer 1);
--   * write: members holding platform.person.hr_details, for ANY member including privileged ones
--     (BR-PPL-f: the fields give no access). Nobody writes their own row without the permission;
--   * system jobs and the Super Admin console never touch it.
-- Audit: the actions write platform.person.hr_details_changed with the field names and no values (BR-PPL-i).

create table platform.person_hr_details (
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  person_id uuid not null,
  gender text,
  birth_date date,
  employment_category text,
  -- [std] without id (one row per person).
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  primary key (tenant_id, person_id),
  constraint person_hr_details_person_fkey foreign key (tenant_id, person_id)
    references platform.persons (tenant_id, id),
  constraint person_hr_details_gender_check check (gender is null or gender in ('male', 'female')),
  constraint person_hr_details_category_check check (
    employment_category is null
    or employment_category in ('management', 'professional', 'technical', 'operational')),
  -- A real date in the past (checked when written).
  constraint person_hr_details_birth_date_check check (
    birth_date is null or (birth_date >= date '1900-01-01' and birth_date < current_date))
);
comment on table platform.person_hr_details is
  'HR-only person fields (FR-IAM-02, WP-ADM-04): gender, date of birth, employment category. Read by the person and members holding platform.person.hr_details; written by the latter. Owner: platform. Class: T.';
comment on column platform.person_hr_details.gender is 'pii:sensitive';
comment on column platform.person_hr_details.birth_date is 'pii:sensitive';
comment on column platform.person_hr_details.employment_category is 'pii:sensitive';

-- Members holding the permission organization-wide, signed in (user claims).
create or replace function private.actor_holds_hr_details(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.request_claims() ->> 'role' = 'authenticated'
         and private.member_has_permission(p_tenant_id, private.request_user_id(), 'platform.person.hr_details');
$$;
comment on function private.actor_holds_hr_details(uuid) is
  'SECURITY-RELEVANT (WP-ADM-04, FR-IAM-02). A signed-in member holding platform.person.hr_details organization-wide (HR Manager; a custom role given the permission).';
revoke all on function private.actor_holds_hr_details(uuid) from public;
grant execute on function private.actor_holds_hr_details(uuid) to authenticated;

-- [std]-style stamps from verified claims; the person and organization of a row never change.
create or replace function private.stamp_person_hr_details()
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
    raise exception 'the person of HR details cannot change' using errcode = 'insufficient_privilege';
  end if;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.updated_at := now();
  new.updated_by := private.request_person_id();
  new.version := old.version + 1;
  return new;
end
$$;
comment on function private.stamp_person_hr_details() is
  'SECURITY-RELEVANT (WP-ADM-04). Stamps created_*/updated_*/version of HR details from verified claims.';
revoke all on function private.stamp_person_hr_details() from public;

create trigger person_hr_details_stamp before insert or update on platform.person_hr_details
  for each row execute function private.stamp_person_hr_details();

alter table platform.person_hr_details enable row level security;
alter table platform.person_hr_details force row level security;

create policy tenant_isolation on platform.person_hr_details
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy person_hr_details_read on platform.person_hr_details for select to authenticated
  -- Cheap answers first, as init-plan subselects (evaluated once per statement, not per row): the person's own
  -- row, then the permission held in the current organization (tenant_isolation already pins every row to it).
  using (person_id = (select private.request_person_id())
         or (select private.actor_holds_hr_details((select private.current_tenant_id()))));
create policy person_hr_details_insert on platform.person_hr_details for insert to authenticated
  with check (tenant_id = (select private.current_tenant_id())
              and (select private.actor_holds_hr_details((select private.current_tenant_id()))));
create policy person_hr_details_update on platform.person_hr_details for update to authenticated
  using (tenant_id = (select private.current_tenant_id())
         and (select private.actor_holds_hr_details((select private.current_tenant_id()))))
  with check (tenant_id = (select private.current_tenant_id())
              and (select private.actor_holds_hr_details((select private.current_tenant_id()))));

-- No DELETE: clearing a field sets it to null; the row goes with the person's record.
revoke all on platform.person_hr_details from public, anon;
grant select on platform.person_hr_details to authenticated;
grant insert (person_id, gender, birth_date, employment_category) on platform.person_hr_details to authenticated;
grant update (gender, birth_date, employment_category) on platform.person_hr_details to authenticated;
