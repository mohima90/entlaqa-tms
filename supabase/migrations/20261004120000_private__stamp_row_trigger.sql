-- [std] / [sd] column maintenance (data model §1.4) for M2 tables. SECURITY INVOKER trigger functions.
-- Actor ids come only from the verified claims of the current transaction (private.request_claims(),
-- set by withUserTx), never from the row the caller sends, so they cannot be forged or backdated.
-- Tables from the walking skeleton keep private.set_updated_at() until they gain the [std] columns.

-- The acting person: the `person_id` of USER claims only (role = authenticated). System claims
-- (withSystemTx jobs) never stamp a person, even if a person_id were present.
create or replace function private.request_person_id()
returns uuid
language sql stable
set search_path = ''
as $$
  select case
           when private.request_claims() ->> 'role' = 'authenticated'
             then private.try_uuid(private.request_claims() ->> 'person_id')
         end;
$$;

comment on function private.request_person_id() is
  'SECURITY-RELEVANT. person_id of verified USER claims (NULL for system claims or when absent).';

revoke all on function private.request_person_id() from public;
grant execute on function private.request_person_id() to authenticated;

-- [std]: INSERT sets created_* = updated_* = (now, acting person) and version 1. UPDATE keeps id,
-- created_at and created_by, sets updated_* and increments version (optimistic-concurrency token,
-- ADR 0011). The primary key is immutable (audit events reference it).
create or replace function private.stamp_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_person uuid := private.request_person_id();
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := v_person;
    new.updated_at := new.created_at;
    new.updated_by := v_person;
    new.version := 1;
  else
    if new.id is distinct from old.id then
      raise exception 'the id of %.% rows cannot change', tg_table_schema, tg_table_name
        using errcode = 'insufficient_privilege';
    end if;
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
  'SECURITY-RELEVANT. Sets [std] columns from verified claims; callers cannot forge created_*/updated_*/version or change id.';

revoke all on function private.stamp_row() from public;

-- [sd]: callers only say "deleted" (deleted_at not null) or "restored" (deleted_at null); the database
-- records when and by whom. INSERT can never create a deleted row.
create or replace function private.stamp_soft_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.deleted_at := null;
    new.deleted_by := null;
  elsif old.deleted_at is null and new.deleted_at is not null then
    new.deleted_at := now();
    new.deleted_by := private.request_person_id();
  elsif new.deleted_at is null then
    new.deleted_by := null;
  else
    new.deleted_at := old.deleted_at;
    new.deleted_by := old.deleted_by;
  end if;
  return new;
end
$$;

comment on function private.stamp_soft_delete() is
  'SECURITY-RELEVANT. Sets [sd] columns (deleted_at/deleted_by) from the clock and verified claims.';

revoke all on function private.stamp_soft_delete() from public;
