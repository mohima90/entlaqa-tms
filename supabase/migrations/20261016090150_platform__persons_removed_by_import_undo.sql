-- People removed by undoing a bulk user import (T-M2-12, FR-IAM-04, BRD §10.4; TM-0003 T-IAM-47).
-- An undo removes the people the import added who have not accepted their invitation (and whom nobody
-- references): their invitation is revoked and they must disappear as if they had never been added — not
-- in the users list, its tabs, search or counts, not in profiles, pickers or later imports, and their work
-- e-mail and employee number are free for a new invitation or import. Their record stays only for the
-- audit trail and referential integrity (the import's rows, the revoked invitation and audit events point
-- at it).
--   removed_at, removed_by_import_id   set once, by the undo of the import that added the person (system
--                                      jobs, import status `undoing`, a person that import created — not
--                                      one it reused); never changed or cleared afterwards. A removed
--                                      person is inactive.
--   persons_not_removed                RESTRICTIVE: user claims never read or write a removed person;
--                                      system jobs do (the undo itself, later bookkeeping).
--   persons_tenant_email_uq,
--   persons_tenant_employee_number_uq  unique among people who are not removed (same names: the request
--                                      path maps them to EMAIL_TAKEN / EMPLOYEE_NUMBER_TAKEN).
-- The import's own look-ups (migration 20261016090200) skip removed people explicitly: jobs see them.

alter table platform.persons
  add column removed_at timestamptz,
  add column removed_by_import_id uuid;

alter table platform.persons
  add constraint persons_removed_by_import_fk foreign key (tenant_id, removed_by_import_id)
    references platform.user_imports (tenant_id, id),
  add constraint persons_removed_check check (
    (removed_at is null) = (removed_by_import_id is null) and (removed_at is null or status = 'inactive'));

comment on column platform.persons.removed_at is
  'SECURITY-RELEVANT (T-M2-12). Removed by undoing the bulk import that added this person: invisible to user claims, e-mail and employee number free again; kept for audit and referential integrity. Never cleared.';
comment on column platform.persons.removed_by_import_id is 'The user import whose undo removed this person (T-M2-12).';

drop index platform.persons_tenant_email_uq;
create unique index persons_tenant_email_uq on platform.persons (tenant_id, email)
  where email is not null and removed_at is null;
drop index platform.persons_tenant_employee_number_uq;
create unique index persons_tenant_employee_number_uq on platform.persons (tenant_id, employee_number)
  where employee_number is not null and removed_at is null;

create policy persons_not_removed on platform.persons
  as restrictive for all to authenticated
  using (removed_at is null or (select private.request_claims() ->> 'role') = 'system')
  with check (removed_at is null or (select private.request_claims() ->> 'role') = 'system');

-- Who may remove a person, and that a removed person never changes again (SECURITY INVOKER; runs as the
-- writing role). Platform operations (migrations, tests as the owner) are not checked.
create or replace function private.check_person_removal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;  -- platform operation
  end if;
  if tg_op = 'INSERT' then
    if new.removed_at is not null or new.removed_by_import_id is not null then
      raise exception 'a person is never created removed' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if old.removed_at is not null then
    raise exception 'a person removed by an import undo never changes' using errcode = 'insufficient_privilege';
  end if;
  if new.removed_at is null and new.removed_by_import_id is null then
    return new;
  end if;
  -- Removing: only the undo of the import that CREATED this person (not one it reused), as a system job.
  if (private.request_claims() ->> 'role') is distinct from 'system'
     or new.removed_by_import_id is null
     or not exists (select 1 from platform.user_imports i
                    join platform.user_import_rows r on r.tenant_id = i.tenant_id and r.import_id = i.id
                    where i.tenant_id = new.tenant_id and i.id = new.removed_by_import_id and i.status = 'undoing'
                      and r.person_id = new.id and r.result = 'added' and r.before is null) then
    raise exception 'only the undo of the import that added a person removes them' using errcode = 'insufficient_privilege';
  end if;
  new.removed_at := now();
  return new;
end
$$;

revoke all on function private.check_person_removal() from public;
comment on function private.check_person_removal() is
  'SECURITY-RELEVANT (T-M2-12, TM-0003 T-IAM-47). Persons are removed only by the undo of the bulk import that created them; a removed person never changes.';

create trigger persons_removal_guard before insert or update on platform.persons
  for each row execute function private.check_person_removal();
