-- [std] column maintenance (data model §1.4) for M2 tables that carry created_by / updated_by / version.
-- SECURITY INVOKER trigger: actor ids come only from the verified claims of the current transaction
-- (private.request_claims(), set by withUserTx / withSystemTx), never from the row the caller sends:
--   INSERT: created_by = updated_by = claims person_id (NULL for system jobs); version = 1;
--   UPDATE: created_at / created_by are kept from the old row; updated_by = claims person_id;
--           updated_at = now(); version = old.version + 1 (optimistic-concurrency token, ADR 0011).
-- Tables from the walking skeleton keep private.set_updated_at() until they gain the [std] columns.

create or replace function private.stamp_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_person uuid := private.try_uuid(private.request_claims() ->> 'person_id');
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := v_person;
    new.updated_at := new.created_at;
    new.updated_by := v_person;
    new.version := 1;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := v_person;
    new.version := old.version + 1;
  end if;
  return new;
end
$$;

comment on function private.stamp_row() is
  'SECURITY-RELEVANT. Sets [std] columns from verified claims; callers cannot forge created_by/updated_by/version.';

revoke all on function private.stamp_row() from public;
