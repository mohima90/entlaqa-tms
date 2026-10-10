-- Bulk user import (FR-IAM-04, FR-IAM-03, BRD §10.4, NFR-PERF-05; T-M2-12; approved screens
-- docs/design/screens/m2-user-import/, PO decisions 9 Oct 2026; runbook docs/engineering/user-import.md).
-- An Organization Admin or HR Manager uploads a CSV/XLSX file (platform-files, ADR 0006: scanned before it
-- is read), maps its columns, reviews a dry run of every row, chooses options and confirms; the worker
-- (ADR 0005, platform task `platform.user_imports`) re-checks every row and adds people in batches of
-- 500 with checkpoints, then schedules their invitations; the importer downloads the error report and may
-- undo the import for 7 days. Class: T. PII: staged rows (values of the file's imported columns), sample
-- values of the columns, the file name.
--
--   platform.user_imports         one row per import: who (from the claims), the file, status, mapping,
--                                 options, counts and progress — never row data. Kept with the audit log
--                                 (who, when, file name, options, counts — PO decision 8).
--   platform.user_import_columns  the columns of the file's sheets: header and up to 3 sample values (the
--                                 mapping step; none for columns that are never imported). Importer and
--                                 jobs only. Deleted with the import's data.
--   platform.user_import_rows     one row per data row of the chosen sheet: the values of the MAPPED
--                                 columns only (raw and normalized), the dry-run outcome and issues, then
--                                 the result and what undo needs. Importer and jobs only (the review and
--                                 the error report are the importer's alone — PO decision 9). Deleted 7
--                                 days after the import ends (unconfirmed reviews: after 24 hours).
--   user_import_guard             NOLOGIN owner of private.claim_user_import_work() — the one
--                                 cross-organization read the worker needs (ids, statuses, timestamps,
--                                 the file's status) and the lease it takes. No BYPASSRLS (pattern of
--                                 file_guard, migration 20261015090000).
--
-- Who may write what:
--   users (Organization Admin, HR Manager — private.user_import_actor_may_import): create an import
--     (status `uploaded`, from their verified claims); only its importer moves it on, while they may
--     still import: mapping (mapping | review → validating), confirm with options (review → queued,
--     before the review expires), cancel before it runs, stop while it runs, undo within 7 days.
--     The lifecycle trigger below checks each move; users never write columns or rows.
--   system jobs (withSystemTx, the import's tenant): everything else along the lifecycle, and the
--     columns and rows (the processing functions of migration 20261016090200).
--   user_import_guard (the claim function): the lease columns only.
--   One RUNNING import (queued … inviting, undoing) per organization at a time (TM-0003 T-IAM-34).
-- Errors: 23505 on user_imports_one_running_uq → ANOTHER_IMPORT_RUNNING (@jadarat/platform-db).

-- ---------------------------------------------------------------------------------------------------
-- Role user_import_guard (attribute policy as in 20260930120000)
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'user_import_guard') then
    create role user_import_guard nologin noinherit nobypassrls;
  end if;
end
$$;

do $$
declare
  r record;
begin
  select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolreplication, rolcreatedb, rolcreaterole
    into r from pg_roles where rolname = 'user_import_guard';
  if r.rolsuper or r.rolbypassrls or r.rolreplication then
    raise exception 'role user_import_guard must be NOSUPERUSER NOBYPASSRLS NOREPLICATION; fix it as a superuser first';
  end if;
  if r.rolinherit or r.rolcreatedb or r.rolcreaterole or r.rolcanlogin then
    alter role user_import_guard nologin noinherit nocreatedb nocreaterole;
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
             where g.rolname = 'user_import_guard' and (m.inherit_option or m.set_option)
               and not u.rolsuper and u.rolname <> current_user) then
    raise exception 'role user_import_guard must have no members besides the migration role';
  end if;
end
$$;

-- The migration role must be able to hand function ownership to user_import_guard.
grant user_import_guard to current_user;
grant usage on schema platform, private to user_import_guard;

-- ---------------------------------------------------------------------------------------------------
-- Who may import (the people and rules of inviting one person: T-M2-07, T-M2-16)
-- ---------------------------------------------------------------------------------------------------
-- May this member (Auth user id) of the organization import people NOW? An active Organization Admin or
-- HR Manager (roles in force). Read again by the jobs whenever the import writes, and by the invitation
-- guard, so a demoted, deactivated or removed importer's import stops adding and inviting people.
-- SECURITY INVOKER.
create or replace function private.user_import_actor_may_import(p_tenant_id uuid, p_user_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select p_user_id is not null
         and private.actor_role_codes(p_tenant_id, p_user_id) && array['tenant_admin', 'hr_manager']::text[];
$$;

comment on function private.user_import_actor_may_import(uuid, uuid) is
  'SECURITY-RELEVANT (FR-IAM-04, T-M2-12). May this member import people now (active Organization Admin or HR Manager)?';

revoke all on function private.user_import_actor_may_import(uuid, uuid) from public;
grant execute on function private.user_import_actor_may_import(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- platform.user_imports
-- ---------------------------------------------------------------------------------------------------
create table platform.user_imports (
  -- Chosen by the request path before the upload is reserved: the uploaded file's owner entity.
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  -- The importer: Auth user and person, stamped from the verified claims (never from input). No FK: the
  -- record outlives the account (as invitations.invited_by).
  created_by uuid not null,
  created_by_person uuid,
  -- The uploaded file (purpose platform.user_import, owner = this import). Default `no action`: a purged
  -- file stays as a tombstone while this row references it (files.md §3).
  file_id uuid not null,
  file_name text not null,
  file_size bigint not null,
  status text not null default 'uploaded',
  -- Why a file was refused or a run did not finish: a stable code shown with a message, never data.
  failure_code text,
  -- The file's sheets (no data): [{"name": …, "rows": n, "columns": n}]. A CSV file has one, unnamed.
  sheets jsonb not null default '[]'::jsonb,
  sheet_index smallint,
  -- Confirmed mapping: {"<column index>": "<field>"} — imported columns only (the others are never read).
  mapping jsonb,
  -- Step 4: {"existing": skip|upsert|update_only, "defaultRole": <code>, "invitations": send|hold}.
  options jsonb,
  -- Dry-run counts (review) and result counts (run): numbers and codes only.
  review_counts jsonb,
  result_counts jsonb,
  rows_total integer not null default 0,
  rows_done integer not null default 0,
  -- Run checkpoint: the last apply order processed (batches of 500, managers first).
  checkpoint integer not null default 0,
  stop_requested_at timestamptz,
  undo_requested_by uuid,
  undo_requested_at timestamptz,
  -- A code from the undo dialog's list (wrong_file | wrong_data | wrong_options | other).
  undo_reason text,
  -- Generated CSV files (purpose platform.user_import_report, for the importer only): the review's list
  -- of problems and the error report after the run.
  review_file_id uuid,
  report_file_id uuid,
  -- Worker lease (private.claim_user_import_work) and back-off after a failed step.
  lease_until timestamptz,
  lease_token uuid,
  next_attempt_at timestamptz not null default now(),
  failures smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  read_at timestamptz,
  reviewed_at timestamptz,
  confirmed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  undone_at timestamptz,
  -- Unconfirmed reviews end 24 hours after the upload (PO decision 8): the file and data are deleted.
  review_expires_at timestamptz not null default now() + interval '24 hours',
  -- When the files, columns and rows were deleted (housekeeping); the import record stays.
  data_purged_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, file_id),
  foreign key (tenant_id, file_id) references platform.files (tenant_id, id),
  foreign key (tenant_id, review_file_id) references platform.files (tenant_id, id),
  foreign key (tenant_id, report_file_id) references platform.files (tenant_id, id),
  constraint user_imports_status_check check (status in (
    'uploaded', 'rejected', 'mapping', 'validating', 'review', 'queued', 'checking', 'importing', 'inviting',
    'finished', 'stopped', 'failed', 'cancelled', 'expired', 'undoing', 'undone')),
  constraint user_imports_failure_code_check check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  constraint user_imports_file_name_check check (
    char_length(file_name) between 1 and 255 and private.has_visible_text(file_name)),
  constraint user_imports_file_size_check check (file_size between 1 and 20971520),
  constraint user_imports_sheets_check check (jsonb_typeof(sheets) = 'array' and jsonb_array_length(sheets) <= 50),
  constraint user_imports_sheet_index_check check (sheet_index is null or sheet_index between 0 and 49),
  constraint user_imports_mapping_check check (mapping is null or jsonb_typeof(mapping) = 'object'),
  constraint user_imports_options_check check (options is null or (
    jsonb_typeof(options) = 'object'
    and options ->> 'existing' in ('skip', 'upsert', 'update_only')
    and options ->> 'invitations' in ('send', 'hold')
    and coalesce(options ->> 'defaultRole', '') ~ '^[a-z][a-z_]{1,62}$')),
  constraint user_imports_counts_check check (
    (review_counts is null or jsonb_typeof(review_counts) = 'object')
    and (result_counts is null or jsonb_typeof(result_counts) = 'object')),
  constraint user_imports_progress_check check (
    rows_total between 0 and 10000 and rows_done between 0 and rows_total and checkpoint >= 0),
  constraint user_imports_undo_reason_check check (
    undo_reason is null or undo_reason in ('wrong_file', 'wrong_data', 'wrong_options', 'other')),
  constraint user_imports_undo_check check (
    (undo_requested_at is null) = (undo_requested_by is null)
    and (status not in ('undoing', 'undone') or undo_requested_at is not null)),
  constraint user_imports_lease_check check ((lease_until is null) = (lease_token is null)),
  constraint user_imports_failures_check check (failures between 0 and 1000)
);
comment on table platform.user_imports is
  'Bulk user imports (FR-IAM-04, T-M2-12). Owner: platform. Class: T. Who, when, file name, options, counts — never row data.';
comment on column platform.user_imports.file_name is 'pii:indirect. Sanitized original file name (may contain names).';

create index user_imports_tenant_created_idx on platform.user_imports (tenant_id, created_at desc);
-- One running import per organization (TM-0003 T-IAM-34). Error 23505 → ANOTHER_IMPORT_RUNNING.
create unique index user_imports_one_running_uq on platform.user_imports (tenant_id)
  where status in ('queued', 'checking', 'importing', 'inviting', 'undoing');
-- The worker's claim: imports with work to do, and those whose data is due for deletion.
create index user_imports_work_idx on platform.user_imports (next_attempt_at)
  where data_purged_at is null;

-- Statuses before the run starts (the review can still be cancelled or expire).
create or replace function private.user_import_draft_statuses()
returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select array['uploaded', 'mapping', 'validating', 'review']::text[];
$$;

revoke all on function private.user_import_draft_statuses() from public;
grant execute on function private.user_import_draft_statuses() to authenticated, user_import_guard;

-- The fields a file column may be mapped to (TM-0003 T-IAM-20: a fixed allow-list — never status,
-- passwords, roles of existing users, memberships, restricted data or tenant columns), each at most once,
-- with the three required ones present: {"<column index 0…199>": "<field>"}.
create or replace function private.user_import_mapping_is_valid(p_mapping jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select jsonb_typeof(p_mapping) = 'object'
         and not exists (
           select 1 from jsonb_each(p_mapping) e
           where e.key !~ '^(0|[1-9][0-9]?|1[0-9][0-9])$' or jsonb_typeof(e.value) <> 'string'
              or (e.value #>> '{}') <> all (array[
                   'email', 'first_name_ar', 'father_name_ar', 'grandfather_name_ar', 'family_name_ar',
                   'first_name_en', 'father_name_en', 'grandfather_name_en', 'family_name_en', 'mobile',
                   'employee_number', 'job_title_ar', 'job_title_en', 'department', 'branch', 'manager_email',
                   'hire_date', 'primary_role', 'additional_roles', 'language']))
         and (select count(*) = count(distinct e.value) from jsonb_each(p_mapping) e)
         and (select count(*) = 3 from jsonb_each_text(p_mapping) e
              where e.value in ('email', 'first_name_ar', 'family_name_ar'));
$$;

comment on function private.user_import_mapping_is_valid(jsonb) is
  'SECURITY-RELEVANT (FR-IAM-04, TM-0003 T-IAM-20). A mapping uses allowed fields only, each once, with e-mail and the Arabic first and family names.';

revoke all on function private.user_import_mapping_is_valid(jsonb) from public;
grant execute on function private.user_import_mapping_is_valid(jsonb) to authenticated;

-- Lifecycle and who may do what (SECURITY INVOKER; runs as the writing role):
--   insert   users only (user claims: the policy and user_import_actor_may_import), status `uploaded`;
--            importer, times and progress stamped here.
--   update   what the import is (tenant, importer, file) never changes.
--            Users: only the importer, while they may still import, and only these moves:
--              mapping | review          → validating   the sheet and mapping (the dry run runs again)
--              review                    → queued       options, before the review expires
--              uploaded … review         → cancelled
--              queued … inviting         stop_requested_at (the run stops after its batch)
--              finished|stopped|failed   → undoing      within 7 days, data not yet deleted, not undone
--            System jobs: the transitions of the table below; times stamped here.
--            user_import_guard (the claim): the lease only.
-- Platform operations (migrations, tests) are not checked beyond the immutable columns.
create or replace function private.check_user_import()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text := private.request_claims() ->> 'role';
  v_user uuid := private.request_user_id();
begin
  if tg_op = 'INSERT' then
    if current_user <> 'authenticated' then
      return new;  -- platform operation
    end if;
    if new.tenant_id is distinct from private.current_tenant_id() then
      return new;  -- rejected by the restrictive tenant_isolation policy
    end if;
    if v_kind is distinct from 'authenticated' or v_user is null then
      raise exception 'only signed-in members start imports' using errcode = 'insufficient_privilege';
    end if;
    if not private.user_import_actor_may_import(new.tenant_id, v_user) then
      raise exception 'only an Organization Admin or an HR Manager imports people' using errcode = 'insufficient_privilege';
    end if;
    if new.status <> 'uploaded' or new.failure_code is not null or new.sheet_index is not null
       or new.mapping is not null or new.options is not null or new.review_counts is not null
       or new.result_counts is not null or new.stop_requested_at is not null or new.undo_requested_by is not null
       or new.undo_requested_at is not null or new.undo_reason is not null or new.data_purged_at is not null
       or new.sheets <> '[]'::jsonb or new.review_file_id is not null or new.report_file_id is not null
       or new.lease_until is not null or new.lease_token is not null then
      raise exception 'an import starts uploaded, with nothing read yet' using errcode = 'check_violation';
    end if;
    -- The uploaded file must be the importer's own upload for this import (purpose and owner).
    if not exists (select 1 from platform.files f
                   where f.tenant_id = new.tenant_id and f.id = new.file_id and f.purpose = 'platform.user_import'
                     and f.owner_module = 'platform' and f.owner_entity_type = 'user_import'
                     and f.owner_entity_id = new.id and f.created_by_user = v_user and f.deleted_at is null) then
      raise exception 'the file must be this import''s own upload' using errcode = 'check_violation';
    end if;
    new.created_by := v_user;
    new.created_by_person := private.request_person_id();
    new.created_at := now();
    new.updated_at := now();
    new.next_attempt_at := now();
    new.failures := 0;
    new.review_expires_at := now() + interval '24 hours';
    new.rows_total := 0;
    new.rows_done := 0;
    new.checkpoint := 0;
    new.read_at := null;
    new.reviewed_at := null;
    new.confirmed_at := null;
    new.started_at := null;
    new.finished_at := null;
    new.undone_at := null;
    return new;
  end if;

  -- UPDATE
  if (new.id, new.tenant_id, new.created_by, new.created_by_person, new.file_id, new.file_name, new.file_size,
      new.created_at)
     is distinct from (old.id, old.tenant_id, old.created_by, old.created_by_person, old.file_id, old.file_name,
                       old.file_size, old.created_at) then
    raise exception 'what an import is cannot change' using errcode = 'check_violation';
  end if;

  if current_user = 'user_import_guard' then
    -- The worker's claim: the lease and nothing else.
    if (to_jsonb(new) - array['lease_until', 'lease_token']) <> (to_jsonb(old) - array['lease_until', 'lease_token']) then
      raise exception 'the claim takes the lease only' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if current_user <> 'authenticated' then
    return new;  -- platform operation
  end if;

  if v_kind = 'system' then
    if new.status is distinct from old.status and (old.status, new.status) not in (
         ('uploaded', 'mapping'), ('uploaded', 'rejected'), ('uploaded', 'expired'), ('uploaded', 'failed'),
         ('mapping', 'expired'),
         ('validating', 'review'), ('validating', 'rejected'), ('validating', 'expired'), ('validating', 'failed'),
         ('review', 'expired'),
         ('queued', 'checking'), ('checking', 'importing'), ('importing', 'inviting'), ('importing', 'finished'),
         ('inviting', 'finished'),
         ('queued', 'stopped'), ('checking', 'stopped'), ('importing', 'stopped'), ('inviting', 'stopped'),
         ('queued', 'failed'), ('checking', 'failed'), ('importing', 'failed'), ('inviting', 'failed'),
         ('undoing', 'undone'), ('undoing', 'failed')) then
      raise exception 'an import does not go from % to %', old.status, new.status using errcode = 'check_violation';
    end if;
    if (new.options, new.mapping, new.sheet_index, new.undo_requested_by, new.undo_requested_at, new.undo_reason,
        new.stop_requested_at)
       is distinct from (old.options, old.mapping, old.sheet_index, old.undo_requested_by, old.undo_requested_at,
                         old.undo_reason, old.stop_requested_at) then
      raise exception 'only the importer chooses the mapping and options, stops or undoes an import'
        using errcode = 'insufficient_privilege';
    end if;
    if new.status is distinct from old.status then
      if new.status = 'mapping' then new.read_at := now(); end if;
      if new.status = 'review' then new.reviewed_at := now(); end if;
      if new.status = 'checking' then new.started_at := now(); end if;
      if new.status in ('finished', 'stopped', 'failed') and old.finished_at is null then new.finished_at := now(); end if;
      if new.status = 'undone' then new.undone_at := now(); end if;
    end if;
    if new.data_purged_at is distinct from old.data_purged_at then
      if old.data_purged_at is not null or new.data_purged_at is null then
        raise exception 'the data of an import is deleted once' using errcode = 'check_violation';
      end if;
      new.data_purged_at := now();
    end if;
    new.updated_at := now();
    return new;
  end if;

  -- User claims: the importer only, while they may still import.
  if v_kind is distinct from 'authenticated' or v_user is null then
    raise exception 'unexpected claims for an import change' using errcode = 'insufficient_privilege';
  end if;
  if old.created_by is distinct from v_user then
    raise exception 'only the person who started an import changes it' using errcode = 'insufficient_privilege';
  end if;
  if not private.user_import_actor_may_import(new.tenant_id, v_user) then
    raise exception 'only an Organization Admin or an HR Manager imports people' using errcode = 'insufficient_privilege';
  end if;
  if (new.failure_code, new.sheets, new.review_counts, new.result_counts, new.rows_total, new.rows_done,
      new.checkpoint, new.read_at, new.reviewed_at, new.started_at, new.finished_at, new.undone_at,
      new.review_expires_at, new.data_purged_at, new.confirmed_at, new.undo_requested_at, new.undo_requested_by,
      new.review_file_id, new.report_file_id, new.lease_until, new.lease_token, new.next_attempt_at, new.failures)
     is distinct from (old.failure_code, old.sheets, old.review_counts, old.result_counts, old.rows_total,
                       old.rows_done, old.checkpoint, old.read_at, old.reviewed_at, old.started_at, old.finished_at,
                       old.undone_at, old.review_expires_at, old.data_purged_at, old.confirmed_at,
                       old.undo_requested_at, old.undo_requested_by, old.review_file_id, old.report_file_id,
                       old.lease_until, old.lease_token, old.next_attempt_at, old.failures) then
    raise exception 'progress and results of an import are written by the import itself' using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();

  if new.status = 'validating' and old.status in ('mapping', 'review') then
    if old.review_expires_at <= now() then
      raise exception 'the review of this import has expired' using errcode = 'check_violation';
    end if;
    if new.mapping is null or new.sheet_index is null
       or (new.options, new.stop_requested_at, new.undo_reason) is distinct from (old.options, old.stop_requested_at, old.undo_reason) then
      raise exception 'choosing the mapping changes the sheet and the mapping only' using errcode = 'check_violation';
    end if;
    if new.sheet_index >= jsonb_array_length(old.sheets) then
      raise exception 'the file has no such sheet' using errcode = 'check_violation';
    end if;
    if not private.user_import_mapping_is_valid(new.mapping) then
      raise exception 'the mapping uses a field that is not imported, twice, or misses a required one'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.status = 'queued' and old.status = 'review' then
    if old.review_expires_at <= now() then
      raise exception 'the review of this import has expired' using errcode = 'check_violation';
    end if;
    if new.options is null
       or (new.mapping, new.sheet_index, new.stop_requested_at, new.undo_reason)
          is distinct from (old.mapping, old.sheet_index, old.stop_requested_at, old.undo_reason) then
      raise exception 'confirming an import sets its options only' using errcode = 'check_violation';
    end if;
    -- The default role is never privileged (PO decision 3): privileged roles are given from the profile.
    if exists (select 1 from platform.ref_roles r where r.code = new.options ->> 'defaultRole' and r.is_privileged)
       or not exists (select 1 from platform.ref_roles r where r.code = new.options ->> 'defaultRole') then
      raise exception 'the default role must be a role that is not privileged' using errcode = 'check_violation';
    end if;
    new.confirmed_at := now();
    new.checkpoint := 0;
    return new;
  end if;
  if new.status = 'cancelled' and old.status = any (private.user_import_draft_statuses()) then
    if (new.mapping, new.sheet_index, new.options, new.stop_requested_at, new.undo_reason)
       is distinct from (old.mapping, old.sheet_index, old.options, old.stop_requested_at, old.undo_reason) then
      raise exception 'cancelling an import changes nothing else' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.status = old.status and old.status in ('queued', 'checking', 'importing', 'inviting')
     and old.stop_requested_at is null and new.stop_requested_at is not null then
    if (new.mapping, new.sheet_index, new.options, new.undo_reason)
       is distinct from (old.mapping, old.sheet_index, old.options, old.undo_reason) then
      raise exception 'stopping an import changes nothing else' using errcode = 'check_violation';
    end if;
    new.stop_requested_at := now();
    return new;
  end if;
  if new.status = 'undoing' and old.status in ('finished', 'stopped', 'failed') then
    if old.confirmed_at is null or old.finished_at is null or old.finished_at <= now() - interval '7 days'
       or old.data_purged_at is not null or old.undone_at is not null then
      raise exception 'this import can no longer be undone' using errcode = 'check_violation';
    end if;
    if (new.mapping, new.sheet_index, new.options, new.stop_requested_at)
       is distinct from (old.mapping, old.sheet_index, old.options, old.stop_requested_at) then
      raise exception 'undoing an import changes nothing else' using errcode = 'check_violation';
    end if;
    new.undo_requested_by := v_user;
    new.undo_requested_at := now();
    new.checkpoint := 0;
    new.failure_code := null;
    new.failures := 0;
    new.next_attempt_at := now();
    return new;
  end if;
  raise exception 'an import cannot be changed this way (% → %)', old.status, new.status
    using errcode = 'insufficient_privilege';
end
$$;

comment on function private.check_user_import() is
  'SECURITY-RELEVANT (FR-IAM-04, T-M2-12). Lifecycle of platform.user_imports: who may move an import on, and how.';

revoke all on function private.check_user_import() from public;

create trigger user_imports_check before insert or update on platform.user_imports
  for each row execute function private.check_user_import();

alter table platform.user_imports enable row level security;
alter table platform.user_imports force row level security;

create policy tenant_isolation on platform.user_imports
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Read: user managers (recent imports of the organization, the running import's banner) and jobs.
create policy user_imports_read on platform.user_imports for select to authenticated
  using ((select private.request_claims() ->> 'role') = 'system'
         or (select private.actor_manages_users((select private.current_tenant_id()))));
create policy user_imports_insert on platform.user_imports for insert to authenticated
  with check ((select private.request_claims() ->> 'role') = 'authenticated'
              and (select private.actor_manages_users((select private.current_tenant_id())))
              and status = 'uploaded');
-- The importer's moves (the trigger checks each one).
create policy user_imports_importer_update on platform.user_imports for update to authenticated
  using ((select private.request_claims() ->> 'role') = 'authenticated'
         and created_by = (select private.request_user_id()))
  with check ((select private.request_claims() ->> 'role') = 'authenticated'
              and created_by = (select private.request_user_id()));
create policy user_imports_jobs_update on platform.user_imports for update to authenticated
  using ((select private.request_claims() ->> 'role') = 'system')
  with check ((select private.request_claims() ->> 'role') = 'system');

revoke all on platform.user_imports from public, anon;
grant select on platform.user_imports to authenticated;
grant insert (id, tenant_id, file_id, file_name, file_size) on platform.user_imports to authenticated;
-- Users change the first group (the trigger allows the importer's moves only); jobs also write progress,
-- results, files and their back-off. The lease belongs to the claim (user_import_guard).
grant update (status, sheet_index, mapping, options, stop_requested_at, undo_reason,
              failure_code, sheets, review_counts, result_counts, rows_total, rows_done, checkpoint,
              review_file_id, report_file_id, lease_until, lease_token, next_attempt_at, failures, data_purged_at)
  on platform.user_imports to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- platform.user_import_columns (mapping step: header and up to 3 sample values per column)
-- ---------------------------------------------------------------------------------------------------
create table platform.user_import_columns (
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  import_id uuid not null,
  sheet_index smallint not null,
  column_index smallint not null,
  header text not null,
  -- First non-empty values (none for columns that are never imported: status, passwords, restricted data).
  samples text[] not null default '{}',
  primary key (tenant_id, import_id, sheet_index, column_index),
  foreign key (tenant_id, import_id) references platform.user_imports (tenant_id, id),
  constraint user_import_columns_index_check check (sheet_index between 0 and 49 and column_index between 0 and 199),
  constraint user_import_columns_header_check check (char_length(header) <= 300),
  constraint user_import_columns_samples_check check (
    cardinality(samples) <= 3 and (cardinality(samples) = 0 or array_ndims(samples) = 1)
    and array_position(samples, null) is null)
);
comment on table platform.user_import_columns is
  'Columns of an import file (header, sample values) for the mapping step (T-M2-12). Importer and jobs only; deleted with the import''s data. Class: T.';
comment on column platform.user_import_columns.samples is 'pii:direct. Up to 3 sample values of the column.';

alter table platform.user_import_columns enable row level security;
alter table platform.user_import_columns force row level security;

create policy tenant_isolation on platform.user_import_columns
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Read: jobs, and the importer while they may still import (sample values are the file's data).
create policy user_import_columns_read on platform.user_import_columns for select to authenticated
  using ((select private.request_claims() ->> 'role') = 'system'
         or ((select private.actor_manages_users((select private.current_tenant_id())))
             and exists (select 1 from platform.user_imports i
                         where i.tenant_id = user_import_columns.tenant_id and i.id = user_import_columns.import_id
                           and i.created_by = (select private.request_user_id()))));
create policy user_import_columns_jobs on platform.user_import_columns for all to authenticated
  using ((select private.request_claims() ->> 'role') = 'system')
  with check ((select private.request_claims() ->> 'role') = 'system');

revoke all on platform.user_import_columns from public, anon;
grant select, insert, delete on platform.user_import_columns to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- platform.user_import_rows (staged rows: values, dry-run outcome, result, undo)
-- ---------------------------------------------------------------------------------------------------
create table platform.user_import_rows (
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  import_id uuid not null,
  -- The row's number in the spreadsheet (the header is row 1), as shown to the importer.
  row_number integer not null,
  -- {"<field>": "<text as read>"} — the mapped columns only (the error report repeats them).
  cells jsonb not null default '{}'::jsonb,
  -- The same values normalized and checked by the worker (e-mail lower-cased, digits, E.164 mobile, ISO
  -- date, role codes, language); a value with a format problem is absent here and named in format_issues.
  data jsonb not null default '{}'::jsonb,
  -- Issues: [{"c": code, "s": e|w|k|i, "f": field?, "p": params?}] — e error (not imported), w warning
  -- (imported, value left empty), k skipped, i information. format_issues come from the worker's checks;
  -- issues = format_issues + what the organization's data says (private.user_import_classify).
  format_issues jsonb not null default '[]'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  review_kind text,
  -- The kind the review showed (the run's fresh check compares with it).
  reviewed_kind text,
  -- The person the e-mail matches; whether they hold a privileged role (an HR Manager's import skips them).
  target_person_id uuid,
  target_privileged boolean not null default false,
  -- For a matched person: what an update would change ([{"f": field, "from": …, "to": …}]).
  changes jsonb,
  -- Resolved references: department, branch, an existing manager — or the file row of the manager.
  department_id uuid,
  branch_id uuid,
  manager_person_id uuid,
  manager_row integer,
  -- Run: processing order (managers first), result and what the import created or changed.
  apply_order integer,
  result text,
  result_issues jsonb,
  person_id uuid,
  invitation_id uuid,
  -- Values a write replaced and the record versions after it (undo restores them unless changed since).
  before jsonb,
  after_versions jsonb,
  undo_result text,
  primary key (tenant_id, import_id, row_number),
  foreign key (tenant_id, import_id) references platform.user_imports (tenant_id, id),
  constraint user_import_rows_row_number_check check (row_number between 2 and 1048576),
  constraint user_import_rows_json_check check (
    jsonb_typeof(cells) = 'object' and jsonb_typeof(data) = 'object' and jsonb_typeof(format_issues) = 'array'
    and jsonb_typeof(issues) = 'array' and (result_issues is null or jsonb_typeof(result_issues) = 'array')
    and (changes is null or jsonb_typeof(changes) = 'array') and (before is null or jsonb_typeof(before) = 'object')
    and (after_versions is null or jsonb_typeof(after_versions) = 'object')),
  constraint user_import_rows_review_kind_check check (
    (review_kind is null or review_kind in ('new', 'existing', 'skip', 'error'))
    and (reviewed_kind is null or reviewed_kind in ('new', 'existing', 'skip', 'error'))),
  constraint user_import_rows_result_check check (
    result is null or result in ('added', 'updated', 'skipped', 'failed', 'not_processed')),
  constraint user_import_rows_undo_result_check check (
    undo_result is null
    or undo_result in ('removed', 'restored', 'kept_accepted', 'kept_changed', 'kept_referenced', 'kept_error'))
);
comment on table platform.user_import_rows is
  'Staged rows of a user import (T-M2-12): mapped values, dry-run issues, results, what undo restores. Importer and jobs only; deleted 7 days after the import (24 h unconfirmed). Class: T.';
comment on column platform.user_import_rows.cells is 'pii:direct. Values of the mapped columns as read from the file.';
comment on column platform.user_import_rows.data is 'pii:direct. The same values normalized.';
comment on column platform.user_import_rows.issues is 'pii:indirect. Reason codes with the values they name.';
comment on column platform.user_import_rows.changes is 'pii:direct. What an update would change (from / to).';
comment on column platform.user_import_rows.before is 'pii:direct. Values an update replaced (undo).';

create index user_import_rows_order_idx on platform.user_import_rows (tenant_id, import_id, apply_order);
create index user_import_rows_kind_idx on platform.user_import_rows (tenant_id, import_id, review_kind);
-- The dry run's look-ups within a file (duplicates, managers in the file, people in the file).
create index user_import_rows_email_idx on platform.user_import_rows (tenant_id, import_id, (data ->> 'email'));
create index user_import_rows_target_idx on platform.user_import_rows (tenant_id, import_id, target_person_id)
  where target_person_id is not null;
create index user_import_rows_manager_idx on platform.user_import_rows (tenant_id, import_id, manager_row)
  where manager_row is not null;

alter table platform.user_import_rows enable row level security;
alter table platform.user_import_rows force row level security;

create policy tenant_isolation on platform.user_import_rows
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Read: jobs, and the importer alone while they may still import (the review and the error report hold
-- employees' data: PO decision 9, TM-0003 T-IAM-30).
create policy user_import_rows_read on platform.user_import_rows for select to authenticated
  using ((select private.request_claims() ->> 'role') = 'system'
         or ((select private.actor_manages_users((select private.current_tenant_id())))
             and exists (select 1 from platform.user_imports i
                         where i.tenant_id = user_import_rows.tenant_id and i.id = user_import_rows.import_id
                           and i.created_by = (select private.request_user_id()))));
create policy user_import_rows_jobs on platform.user_import_rows for all to authenticated
  using ((select private.request_claims() ->> 'role') = 'system')
  with check ((select private.request_claims() ->> 'role') = 'system');

revoke all on platform.user_import_rows from public, anon;
grant select, insert, delete on platform.user_import_rows to authenticated;
grant update (data, format_issues, issues, review_kind, reviewed_kind, target_person_id, target_privileged, changes, department_id,
              branch_id, manager_person_id, manager_row, apply_order, result, result_issues, person_id,
              invitation_id, before, after_versions, undo_result)
  on platform.user_import_rows to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- The worker's claim across organizations (owner user_import_guard)
-- ---------------------------------------------------------------------------------------------------
-- What the claim reads: the imports' lifecycle columns, their file's status, the organizations' status
-- and whether held invitations are due (migration 20261016090100 adds that read).
create policy user_imports_guard_read on platform.user_imports for select to user_import_guard using (true);
create policy user_imports_guard_lease on platform.user_imports for update to user_import_guard
  using (true) with check (true);
grant select (id, tenant_id, file_id, status, review_expires_at, finished_at, undone_at, confirmed_at,
              data_purged_at, lease_until, lease_token, next_attempt_at, updated_at, created_at)
  on platform.user_imports to user_import_guard;
grant update (lease_until, lease_token) on platform.user_imports to user_import_guard;
create policy files_user_import_guard_read on platform.files for select to user_import_guard using (true);
grant select (id, tenant_id, status) on platform.files to user_import_guard;
create policy tenants_user_import_guard_read on platform.tenants for select to user_import_guard using (true);
grant select (id, status) on platform.tenants to user_import_guard;
-- What the lifecycle trigger reads when the claim writes the lease (the claims, nothing of a tenant).
grant execute on function private.request_claims() to user_import_guard;
grant execute on function private.try_uuid(text) to user_import_guard;
grant execute on function private.request_user_id() to user_import_guard;
-- (and the row's checks: the file name's visible-text check runs on every update)
grant execute on function private.has_visible_text(text) to user_import_guard;

-- The step an import needs now (the claim and the worker agree on it), or null:
--   expire  a review not confirmed within 24 hours (file and data deleted);
--   read    the uploaded file has its verdict (clean, or refused): read its sheets and columns;
--   validate / run / undo   the worker's part of those statuses;
--   send    held invitations of the import whose sending time has come (migration 20261016090100);
--   purge   a refused, cancelled, expired or failed-before-running import, or one that ended 7 days ago:
--           files and data deleted, the import record kept (PO decision 8).
create or replace function private.user_import_step(p_tenant_id uuid, p_import_id uuid, p_status text,
                                                   p_review_expires_at timestamptz, p_finished_at timestamptz,
                                                   p_undone_at timestamptz, p_confirmed_at timestamptz,
                                                   p_data_purged_at timestamptz, p_file_status text)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when p_data_purged_at is not null then null
    when p_status = any (private.user_import_draft_statuses()) and p_review_expires_at <= now()
      then 'expire'
    when p_status = 'uploaded'
         and p_file_status in ('clean', 'infected', 'rejected', 'error', 'deleted') then 'read'
    when p_status = 'validating' then 'validate'
    when p_status in ('queued', 'checking', 'importing', 'inviting') then 'run'
    when p_status = 'undoing' then 'undo'
    when p_status in ('rejected', 'cancelled', 'expired')
         or (p_status = 'failed' and p_confirmed_at is null) then 'purge'
    when p_status in ('finished', 'stopped', 'failed', 'undone')
         and greatest(p_finished_at, p_undone_at) <= now() - interval '7 days' then 'purge'
  end;
$$;

comment on function private.user_import_step(uuid, uuid, text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, text) is
  'The worker step an import needs now (expire, read, validate, run, undo, purge) or null (T-M2-12).';

revoke all on function private.user_import_step(uuid, uuid, text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, text) from public;
grant execute on function private.user_import_step(uuid, uuid, text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, text) to authenticated, user_import_guard;

-- A job of the worker without a tenant (withPlatformTx): system claims with a job id under app_worker.
create or replace function private.user_import_worker_check()
returns void
language plpgsql stable
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
begin
  if session_user <> 'app_worker' or coalesce(v_claims ->> 'role', '') <> 'system'
     or coalesce(btrim(v_claims ->> 'job_id'), '') = '' then
    raise exception 'reserved to the worker' using errcode = 'insufficient_privilege';
  end if;
end
$$;
revoke all on function private.user_import_worker_check() from public;

-- Leases the next import that needs work (15 minutes; the worker renews it with every batch and releases
-- it when the step ends). Organizations that are not served (suspended, closed) wait. Oldest due first.
-- Returns the organization, the import, the step and the lease token every transaction of the step
-- checks. Ids, statuses and timestamps only.
create or replace function private.claim_user_import_work()
returns table (tenant_id uuid, import_id uuid, step text, lease_token uuid)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_step text;
  v_token uuid := gen_random_uuid();
begin
  perform private.user_import_worker_check();
  select i.id, private.user_import_step(i.tenant_id, i.id, i.status, i.review_expires_at, i.finished_at, i.undone_at,
                                        i.confirmed_at, i.data_purged_at, f.status)
    into v_id, v_step
  from platform.user_imports i
  join platform.tenants t on t.id = i.tenant_id and t.status in ('active', 'trial')
  left join platform.files f on f.tenant_id = i.tenant_id and f.id = i.file_id
  where i.data_purged_at is null and i.next_attempt_at <= now()
    and (i.lease_until is null or i.lease_until <= now())
    and private.user_import_step(i.tenant_id, i.id, i.status, i.review_expires_at, i.finished_at, i.undone_at,
                                 i.confirmed_at, i.data_purged_at, f.status) is not null
  order by i.next_attempt_at, i.updated_at, i.id
  limit 1
  for update of i skip locked;
  if v_id is null then
    return;
  end if;
  update platform.user_imports i
  set lease_until = now() + interval '15 minutes', lease_token = v_token
  where i.id = v_id;
  return query select i.tenant_id, i.id, v_step, v_token from platform.user_imports i where i.id = v_id;
end
$$;

comment on function private.claim_user_import_work() is
  'SECURITY-RELEVANT (T-M2-12). Worker: leases the next import that needs a step (ids, step, lease token). app_worker system claims only; owner user_import_guard.';

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to user_import_guard;
alter function private.claim_user_import_work() owner to user_import_guard;
alter function private.user_import_worker_check() owner to user_import_guard;
revoke create on schema private from user_import_guard;
revoke all on function private.claim_user_import_work() from public;
-- The function checks the LOGIN role (app_worker) and the system claims itself.
grant execute on function private.claim_user_import_work() to authenticated;
