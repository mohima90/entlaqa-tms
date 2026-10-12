-- Processing of a bulk user import (FR-IAM-04, T-M2-12; docs/engineering/user-import.md). The worker
-- (platform task `platform.user_imports`, ADR 0005) stages the mapped rows of the file — values it has
-- already normalized and checked for format (TypeScript: @jadarat/platform-import) — and then calls these
-- functions in the import's tenant transaction (withSystemTx: system claims, RLS applies; SECURITY
-- INVOKER, so every trigger and guard of the tables they write applies as for any other system job):
--
--   private.user_import_classify(import)        the dry run: what the organization's data says about
--                                                every row (duplicates, existing people, employee
--                                                numbers, departments, branches, managers, loops); the
--                                                kind of each row (new | existing | skip | error) and
--                                                the order to add them in (managers first). Run again
--                                                at the start of the run (the fresh check).
--   private.user_import_review_counts(import)   numbers for the review screens (no row data).
--   private.user_import_apply_batch(import, n)   adds / updates the next n rows (one batch, one
--                                                transaction, after the checkpoint), each row on its own
--                                                (a refused row is recorded, the others go on).
--   private.user_import_finish_rows(import)      the result of every row not written.
--   private.user_import_result_counts(import)   numbers for the result screen.
--   private.user_import_release_next(import, …) sends the next held invitation whose time has come, at
--                                                the platform-wide pace and under the organization's
--                                                daily number (security review M2).
--   private.user_import_undo_batch(import, n)    undoes the next n rows (BRD §10.4), while the member who
--                                                asked may still undo it (security review L1).
--
-- People are added with a HELD invitation of the importer (migration 20261016090100): never a
-- privileged role (PO decision 3), never a role for people who already exist (PO decision 5), never a
-- reactivation or deactivation (PO decision 11). Every person invited or updated is audited (system
-- actor; data.importId links the event to the import), as an invitation or a user update is today.
-- Errors: JU001 the importer may no longer import (the run fails); JU002 a row changed since the review
-- (recorded on the row).

-- A job of the import's organization: system claims with a tenant (under app_worker, checked by
-- private.current_tenant_id()). Returns the tenant.
create or replace function private.user_import_job_tenant()
returns uuid
language plpgsql stable
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
begin
  if (private.request_claims() ->> 'role') is distinct from 'system' or v_tenant is null then
    raise exception 'reserved to a job of the import''s organization' using errcode = 'insufficient_privilege';
  end if;
  return v_tenant;
end
$$;
revoke all on function private.user_import_job_tenant() from public;
grant execute on function private.user_import_job_tenant() to authenticated;

-- One issue as a one-element array: {"c": code, "s": e|w|k|i, "f": field, "p": params} (nulls dropped).
create or replace function private.user_import_issue(p_code text, p_severity text, p_field text default null,
                                                     p_params jsonb default null)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('c', p_code, 's', p_severity, 'f', p_field,
                                                                'p', p_params)));
$$;
revoke all on function private.user_import_issue(text, text, text, jsonb) from public;
grant execute on function private.user_import_issue(text, text, text, jsonb) to authenticated;

-- The per-tenant locks an import batch takes ONCE, before its first write, in the global order of the
-- people locks (T-M2-02 note, T-M2-09: departments → branches → person_employment → role_assignments):
-- the rows of the batch then never wait for each other's triggers, and a concurrent deactivation, unit
-- deletion or role change either commits before the batch (and the batch sees it) or waits for it. The
-- triggers the batch fires take the same locks again (re-entrant). READ COMMITTED only.
create or replace function private.user_import_lock_tenant(p_tenant_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_tenant_id is null then
    raise exception 'no organization to lock' using errcode = 'insufficient_privilege';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('platform.departments:' || p_tenant_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('platform.branches:' || p_tenant_id::text, 0));
  perform private.lock_person_employment(p_tenant_id);
  perform private.lock_tenant_roles(p_tenant_id);
end
$$;
comment on function private.user_import_lock_tenant(uuid) is
  'Per-tenant locks of one import batch, in the global order departments → branches → person_employment → role_assignments (T-M2-12).';
revoke all on function private.user_import_lock_tenant(uuid) from public;
grant execute on function private.user_import_lock_tenant(uuid) to authenticated;

-- What an update of this person would change: [{"f": field, "from": text, "to": text}] for every field
-- the file gives (an empty cell never clears a value) that differs from the record. Departments, branches
-- and managers are named (Arabic names), not by id.
create or replace function private.user_import_changes(p_tenant_id uuid, p_person_id uuid, p_data jsonb,
                                                       p_department_id uuid, p_branch_id uuid,
                                                       p_manager_person_id uuid, p_manager_email text)
returns jsonb
language sql stable
set search_path = ''
as $$
  with p as (select * from platform.persons where tenant_id = p_tenant_id and id = p_person_id),
       e as (select * from platform.person_employment where tenant_id = p_tenant_id and person_id = p_person_id),
       f(ord, field, current_value, file_value) as (
         select 1, 'first_name_ar', (select first_name_ar from p), p_data ->> 'first_name_ar'
         union all select 2, 'father_name_ar', (select father_name_ar from p), p_data ->> 'father_name_ar'
         union all select 3, 'grandfather_name_ar', (select grandfather_name_ar from p), p_data ->> 'grandfather_name_ar'
         union all select 4, 'family_name_ar', (select family_name_ar from p), p_data ->> 'family_name_ar'
         union all select 5, 'first_name_en', (select first_name_en from p), p_data ->> 'first_name_en'
         union all select 6, 'father_name_en', (select father_name_en from p), p_data ->> 'father_name_en'
         union all select 7, 'grandfather_name_en', (select grandfather_name_en from p), p_data ->> 'grandfather_name_en'
         union all select 8, 'family_name_en', (select family_name_en from p), p_data ->> 'family_name_en'
         union all select 9, 'mobile', (select mobile_e164 from p), p_data ->> 'mobile'
         union all select 10, 'employee_number', (select employee_number from p), p_data ->> 'employee_number'
         union all select 11, 'job_title_ar', (select job_title_ar from e), p_data ->> 'job_title_ar'
         union all select 12, 'job_title_en', (select job_title_en from e), p_data ->> 'job_title_en'
         union all select 13, 'department',
           (select d.name_ar from e join platform.departments d on d.tenant_id = e.tenant_id and d.id = e.department_id),
           case when p_department_id is distinct from (select department_id from e)
                then (select d.name_ar from platform.departments d where d.tenant_id = p_tenant_id and d.id = p_department_id) end
         union all select 14, 'branch',
           (select b.name_ar from e join platform.branches b on b.tenant_id = e.tenant_id and b.id = e.branch_id),
           case when p_branch_id is distinct from (select branch_id from e)
                then (select b.name_ar from platform.branches b where b.tenant_id = p_tenant_id and b.id = p_branch_id) end
         union all select 15, 'manager',
           (select m.display_name_ar from e join platform.persons m on m.tenant_id = e.tenant_id and m.id = e.manager_person_id),
           case when p_manager_person_id is not null and p_manager_person_id is distinct from (select manager_person_id from e)
                  then (select m.display_name_ar from platform.persons m where m.tenant_id = p_tenant_id and m.id = p_manager_person_id)
                when p_manager_person_id is null and p_manager_email is not null then p_manager_email end
         union all select 16, 'hire_date', (select hire_on::text from e), p_data ->> 'hire_date')
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('f', f.field, 'from', f.current_value, 'to', f.file_value))
                            order by f.ord), '[]'::jsonb)
  from f
  where f.file_value is not null and f.file_value is distinct from f.current_value;
$$;
revoke all on function private.user_import_changes(uuid, uuid, jsonb, uuid, uuid, uuid, text) from public;
grant execute on function private.user_import_changes(uuid, uuid, jsonb, uuid, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- The dry run
-- ---------------------------------------------------------------------------------------------------
create or replace function private.user_import_classify(p_import_id uuid)
returns void
language plpgsql volatile
set search_path = ''
as $$
declare
  v_tenant uuid := private.user_import_job_tenant();
  v_importer uuid;
  v_importer_person uuid;
begin
  select i.created_by into v_importer from platform.user_imports i where i.id = p_import_id;
  if not found then
    raise exception 'unknown import' using errcode = 'no_data_found';
  end if;
  select m.person_id into v_importer_person
  from platform.tenant_memberships m where m.tenant_id = v_tenant and m.user_id = v_importer;

  update platform.user_import_rows r
  set issues = r.format_issues, review_kind = null, target_person_id = null, target_privileged = false,
      changes = null, department_id = null, branch_id = null, manager_person_id = null, manager_row = null,
      apply_order = null
  where r.tenant_id = v_tenant and r.import_id = p_import_id;

  -- The same e-mail or employee number more than once in the file: every such row is an error until
  -- the value appears once (the system never picks one silently, TM-0003 T-IAM-20).
  with d as (
    select r.data ->> 'email' as email, array_agg(r.row_number order by r.row_number) as rows_
    from platform.user_import_rows r
    where r.tenant_id = v_tenant and r.import_id = p_import_id and r.data ? 'email'
    group by 1 having count(*) > 1)
  update platform.user_import_rows r
  set issues = r.issues || private.user_import_issue('EMAIL_DUPLICATE_IN_FILE', 'e', 'email',
                 jsonb_build_object('rows', to_jsonb(d.rows_[1:6]), 'count', cardinality(d.rows_)))
  from d
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.data ->> 'email' = d.email;

  with d as (
    select r.data ->> 'employee_number' as number, array_agg(r.row_number order by r.row_number) as rows_
    from platform.user_import_rows r
    where r.tenant_id = v_tenant and r.import_id = p_import_id and r.data ? 'employee_number'
    group by 1 having count(*) > 1)
  update platform.user_import_rows r
  set issues = r.issues || private.user_import_issue('EMPLOYEE_NUMBER_DUPLICATE_IN_FILE', 'e', 'employee_number',
                 jsonb_build_object('rows', to_jsonb(d.rows_[1:6]), 'count', cardinality(d.rows_)))
  from d
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.data ->> 'employee_number' = d.number;

  -- The key: the work e-mail (lower-cased on both sides), this organization's people only — never a person
  -- removed by an earlier undo (as if never added: migration 20261016090150).
  update platform.user_import_rows r
  set target_person_id = p.id
  from platform.persons p
  where r.tenant_id = v_tenant and r.import_id = p_import_id and p.tenant_id = v_tenant
    and p.email = r.data ->> 'email' and p.removed_at is null;

  -- Who they are now: the importer (never changed by import), an active member (existing), a deactivated
  -- or removed member, someone with an invitation not accepted yet (skipped); a person without any
  -- account or invitation is invited again (kind new, their record reused).
  update platform.user_import_rows r
  set issues = r.issues || x.issue, target_privileged = x.privileged
  from (
    select r2.row_number,
           case
             when r2.target_person_id is not null and r2.target_person_id = v_importer_person
               then private.user_import_issue('OWN_ROW', 'k')
             when m.status = 'active' then '[]'::jsonb
             when m.status in ('suspended', 'revoked') then private.user_import_issue('MEMBER_DEACTIVATED', 'k')
             when m.status = 'invited' then private.user_import_issue('INVITATION_PENDING', 'k')
             when exists (select 1 from platform.invitations i
                          where i.tenant_id = v_tenant and i.status = 'pending'
                            and (i.person_id = r2.target_person_id or i.email = r2.data ->> 'email'))
               then private.user_import_issue('INVITATION_PENDING', 'k')
             else '[]'::jsonb
           end as issue,
           coalesce(m.status = 'active' and private.membership_is_privileged(m.tenant_id, m.id), false) as privileged
    from platform.user_import_rows r2
    left join platform.tenant_memberships m on m.tenant_id = v_tenant and m.person_id = r2.target_person_id
    where r2.tenant_id = v_tenant and r2.import_id = p_import_id and r2.data ? 'email') x
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = x.row_number;

  -- An employee number that belongs to someone else: an error; the e-mail of one person with the number
  -- of another: a key conflict, neither is changed (TM-0004 T-PEO-10).
  update platform.user_import_rows r
  set issues = r.issues || case
        when r.target_person_id is null
          then private.user_import_issue('EMPLOYEE_NUMBER_TAKEN', 'e', 'employee_number',
                                         jsonb_build_object('number', r.data ->> 'employee_number'))
        else private.user_import_issue('KEY_CONFLICT', 'e', 'employee_number')
      end
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.data ? 'employee_number'
    and exists (select 1 from platform.persons p
                where p.tenant_id = v_tenant and p.employee_number = r.data ->> 'employee_number'
                  and p.removed_at is null and p.id is distinct from r.target_person_id);

  -- Department and branch: by code (letter case ignored), else by name (Arabic or English, letter variants,
  -- diacritics and case ignored: private.search_key). Not found or two by that name: the person is added
  -- without it (warning); the import never creates departments or branches (PO decision 12).
  update platform.user_import_rows r
  set department_id = case when x.n = 1 then x.id end,
      issues = r.issues || case
        when x.n = 1 then '[]'::jsonb
        when x.n > 1 then private.user_import_issue('DEPARTMENT_AMBIGUOUS', 'w', 'department',
                                                    jsonb_build_object('name', r.data ->> 'department'))
        else private.user_import_issue('DEPARTMENT_NOT_FOUND', 'w', 'department',
                                       jsonb_build_object('name', r.data ->> 'department'))
      end
  from (
    select r2.row_number, coalesce(c.n, nm.n, 0) as n, coalesce(c.id, nm.id) as id
    from platform.user_import_rows r2
    left join lateral (
      select count(*) as n, min(d.id::text)::uuid as id from platform.departments d
      where d.tenant_id = v_tenant and d.deleted_at is null and lower(d.code) = lower(r2.data ->> 'department')
      having count(*) > 0) c on true
    left join lateral (
      select count(*) as n, min(d.id::text)::uuid as id from platform.departments d
      where d.tenant_id = v_tenant and d.deleted_at is null
        and (private.search_key(d.name_ar) = private.search_key(r2.data ->> 'department')
             or private.search_key(d.name_en) = private.search_key(r2.data ->> 'department'))
      having count(*) > 0) nm on c.n is null
    where r2.tenant_id = v_tenant and r2.import_id = p_import_id and r2.data ? 'department') x
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = x.row_number;

  update platform.user_import_rows r
  set branch_id = case when x.n = 1 then x.id end,
      issues = r.issues || case
        when x.n = 1 then '[]'::jsonb
        when x.n > 1 then private.user_import_issue('BRANCH_AMBIGUOUS', 'w', 'branch',
                                                    jsonb_build_object('name', r.data ->> 'branch'))
        else private.user_import_issue('BRANCH_NOT_FOUND', 'w', 'branch', jsonb_build_object('name', r.data ->> 'branch'))
      end
  from (
    select r2.row_number, coalesce(c.n, nm.n, 0) as n, coalesce(c.id, nm.id) as id
    from platform.user_import_rows r2
    left join lateral (
      select count(*) as n, min(b.id::text)::uuid as id from platform.branches b
      where b.tenant_id = v_tenant and b.deleted_at is null and lower(b.code) = lower(r2.data ->> 'branch')
      having count(*) > 0) c on true
    left join lateral (
      select count(*) as n, min(b.id::text)::uuid as id from platform.branches b
      where b.tenant_id = v_tenant and b.deleted_at is null
        and (private.search_key(b.name_ar) = private.search_key(r2.data ->> 'branch')
             or private.search_key(b.name_en) = private.search_key(r2.data ->> 'branch'))
      having count(*) > 0) nm on c.n is null
    where r2.tenant_id = v_tenant and r2.import_id = p_import_id and r2.data ? 'branch') x
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = x.row_number;

  -- The direct manager: never oneself; an active member of the organization (an active person with an
  -- active membership), else the person of another row of the file (an e-mail that appears once).
  update platform.user_import_rows r
  set issues = r.issues || private.user_import_issue('MANAGER_SELF', 'e', 'manager_email')
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.data ? 'manager_email'
    and r.data ->> 'manager_email' = r.data ->> 'email';

  update platform.user_import_rows r
  set manager_person_id = p.id
  from platform.persons p
  join platform.tenant_memberships m on m.tenant_id = p.tenant_id and m.person_id = p.id and m.status = 'active'
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.data ? 'manager_email'
    and r.data ->> 'manager_email' is distinct from r.data ->> 'email'
    and p.tenant_id = v_tenant and p.status = 'active' and p.email = r.data ->> 'manager_email';

  update platform.user_import_rows r
  set manager_row = m.row_number
  from platform.user_import_rows m
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.manager_person_id is null
    and r.data ? 'manager_email' and r.data ->> 'manager_email' is distinct from r.data ->> 'email'
    and m.tenant_id = v_tenant and m.import_id = p_import_id and m.data ->> 'email' = r.data ->> 'manager_email'
    and not exists (select 1 from platform.user_import_rows m2
                    where m2.tenant_id = v_tenant and m2.import_id = p_import_id
                      and m2.data ->> 'email' = m.data ->> 'email' and m2.row_number <> m.row_number);

  -- Loops in the reporting line formed by rows of the file (A → B → A, or longer), also through people
  -- who already exist and are in the file: every row of the loop is an error (TM-0004 AB-PEO-03).
  with recursive link as (
    select r.row_number,
           coalesce(r.manager_row,
                    (select min(m.row_number) from platform.user_import_rows m
                     where m.tenant_id = v_tenant and m.import_id = p_import_id
                       and m.target_person_id = r.manager_person_id and r.manager_person_id is not null)) as next_row
    from platform.user_import_rows r
    where r.tenant_id = v_tenant and r.import_id = p_import_id),
  walk (start_row, cur_row, depth) as (
    select l.row_number, l.next_row, 1 from link l where l.next_row is not null
    union all
    select w.start_row, l.next_row, w.depth + 1
    from walk w join link l on l.row_number = w.cur_row
    where l.next_row is not null and w.cur_row <> w.start_row and w.depth < 60),
  loops as (
    select w.start_row, array_agg(distinct w.cur_row) filter (where w.cur_row <> w.start_row) as others
    from walk w
    where w.start_row in (select w2.start_row from walk w2 where w2.cur_row = w2.start_row)
    group by w.start_row)
  update platform.user_import_rows r
  set issues = r.issues || private.user_import_issue('MANAGER_LOOP', 'e', 'manager_email',
                 jsonb_build_object('rows', to_jsonb(coalesce(l.others[1:6], '{}'::integer[]))))
  from loops l
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = l.start_row;

  -- The kind of each row.
  update platform.user_import_rows r
  set review_kind = case
        when r.issues @> '[{"s": "e"}]' then 'error'
        when r.issues @> '[{"s": "k"}]' then 'skip'
        when r.target_person_id is not null
             and exists (select 1 from platform.tenant_memberships m
                         where m.tenant_id = v_tenant and m.person_id = r.target_person_id and m.status = 'active')
          then 'existing'
        else 'new'
      end
  where r.tenant_id = v_tenant and r.import_id = p_import_id;

  -- A manager in the file who will not be added (error or skipped row): the person is added without one.
  update platform.user_import_rows r
  set manager_row = null
  from platform.user_import_rows m
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.manager_row is not null
    and m.tenant_id = v_tenant and m.import_id = p_import_id and m.row_number = r.manager_row
    and m.review_kind <> 'new';
  update platform.user_import_rows r
  set issues = r.issues || private.user_import_issue('MANAGER_NOT_FOUND', 'w', 'manager_email',
                                                     jsonb_build_object('email', r.data ->> 'manager_email'))
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.data ? 'manager_email'
    and r.review_kind in ('new', 'existing') and r.manager_row is null and r.manager_person_id is null
    and r.data ->> 'manager_email' is distinct from r.data ->> 'email';

  -- Roles of people who already exist never change by import (PO decision 5): the role columns of their
  -- rows are not read (warning).
  update platform.user_import_rows r
  set issues = r.issues || private.user_import_issue('ROLES_IGNORED_EXISTING', 'w', 'primary_role')
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.review_kind = 'existing'
    and (r.data ->> 'roles_given')::boolean is true;

  -- What an update would change (existing people) or what the reused record gets (invited again).
  update platform.user_import_rows r
  set changes = private.user_import_changes(v_tenant, r.target_person_id, r.data, r.department_id, r.branch_id,
                                            r.manager_person_id,
                                            case when r.manager_row is not null then r.data ->> 'manager_email' end)
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.target_person_id is not null
    and r.review_kind in ('new', 'existing');

  -- Order: managers before the people who report to them (depth in the file's reporting lines), then the
  -- row number. Rows too deep to place (more than 60 levels in the file) are errors.
  with recursive depth (row_number, d) as (
    select r.row_number, 0
    from platform.user_import_rows r
    where r.tenant_id = v_tenant and r.import_id = p_import_id and r.review_kind in ('new', 'existing')
      and r.manager_row is null
    union all
    select r.row_number, x.d + 1
    from depth x
    join platform.user_import_rows r on r.tenant_id = v_tenant and r.import_id = p_import_id
                                    and r.manager_row = x.row_number and r.review_kind in ('new', 'existing')
    where x.d < 60)
  update platform.user_import_rows r
  set apply_order = x.d * 2000000 + r.row_number
  from (select row_number, max(d) as d from depth group by row_number) x
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = x.row_number;
  update platform.user_import_rows r
  set issues = r.issues || private.user_import_issue('MANAGER_LOOP', 'e', 'manager_email'),
      review_kind = 'error'
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.review_kind in ('new', 'existing')
    and r.apply_order is null;

  -- What the review shows (the run compares with it).
  update platform.user_import_rows r set reviewed_kind = r.review_kind
  where r.tenant_id = v_tenant and r.import_id = p_import_id;
end
$$;

comment on function private.user_import_classify(uuid) is
  'The dry run of a user import (FR-IAM-04, T-M2-12): issues from the organization''s data, the kind and order of every row. System claims of the import''s tenant.';
revoke all on function private.user_import_classify(uuid) from public;
grant execute on function private.user_import_classify(uuid) to authenticated;

-- Numbers for the review (no row data): kinds, rows per issue code, primary and additional roles of the
-- people to add, rows that get the default role.
create or replace function private.user_import_review_counts(p_import_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  with r as (
    select * from platform.user_import_rows
    where tenant_id = (select private.user_import_job_tenant()) and import_id = p_import_id),
  codes as (
    select i ->> 's' as severity, i ->> 'c' as code, count(distinct r.row_number) as n
    from r, jsonb_array_elements(r.issues) i
    where (i ->> 's' = 'e' and r.review_kind = 'error')
       or (i ->> 's' = 'k' and r.review_kind = 'skip')
       or (i ->> 's' in ('w', 'i') and r.review_kind in ('new', 'existing'))
    group by 1, 2)
  select jsonb_build_object(
    'total', (select count(*) from r),
    'new', (select count(*) from r where review_kind = 'new'),
    'newReinvited', (select count(*) from r where review_kind = 'new' and target_person_id is not null),
    'newWithWarnings', (select count(*) from r where review_kind = 'new' and issues @> '[{"s": "w"}]'),
    'existing', (select count(*) from r where review_kind = 'existing'),
    'existingWithChanges', (select count(*) from r where review_kind = 'existing' and jsonb_array_length(coalesce(changes, '[]')) > 0),
    'existingPrivileged', (select count(*) from r where review_kind = 'existing' and target_privileged),
    'existingPrivilegedWithChanges', (select count(*) from r where review_kind = 'existing' and target_privileged
                                        and jsonb_array_length(coalesce(changes, '[]')) > 0),
    'existingWithWarnings', (select count(*) from r where review_kind = 'existing' and issues @> '[{"s": "w"}]'),
    'skipped', (select count(*) from r where review_kind = 'skip'),
    'errors', (select count(*) from r where review_kind = 'error'),
    'warnings', (select count(*) from r where review_kind in ('new', 'existing') and issues @> '[{"s": "w"}]'),
    'defaultRole', (select count(*) from r where review_kind = 'new' and not data ? 'primary_role'),
    'errorCodes', coalesce((select jsonb_object_agg(code, n) from codes where severity = 'e'), '{}'::jsonb),
    'warningCodes', coalesce((select jsonb_object_agg(code, n) from codes where severity = 'w'), '{}'::jsonb),
    'skipCodes', coalesce((select jsonb_object_agg(code, n) from codes where severity = 'k'), '{}'::jsonb),
    'roles', coalesce((select jsonb_object_agg(role, n) from (
        select data ->> 'primary_role' as role, count(*) as n from r
        where review_kind = 'new' and data ? 'primary_role' group by 1) x), '{}'::jsonb),
    'additionalRoles', coalesce((select jsonb_object_agg(role, n) from (
        select a as role, count(*) as n from r, jsonb_array_elements_text(coalesce(r.data -> 'additional_roles', '[]')) a
        where r.review_kind = 'new' group by 1) x), '{}'::jsonb));
$$;
comment on function private.user_import_review_counts(uuid) is
  'Review numbers of a user import (T-M2-12): kinds, rows per code, roles. No row data. System claims.';
revoke all on function private.user_import_review_counts(uuid) from public;
grant execute on function private.user_import_review_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- The run
-- ---------------------------------------------------------------------------------------------------
-- The record's current values of the fields the file gives and that differ (what undo restores), as
-- {"<column>": value}. Persons and placement columns.
create or replace function private.user_import_person_before(p_tenant_id uuid, p_person_id uuid, p_data jsonb,
                                                             p_department_id uuid, p_branch_id uuid,
                                                             p_manager_person_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  with p as (select * from platform.persons where tenant_id = p_tenant_id and id = p_person_id),
       e as (select * from platform.person_employment where tenant_id = p_tenant_id and person_id = p_person_id),
       f(col, current_value, new_value) as (
         select 'first_name_ar', to_jsonb((select first_name_ar from p)), p_data -> 'first_name_ar'
         union all select 'father_name_ar', to_jsonb((select father_name_ar from p)), p_data -> 'father_name_ar'
         union all select 'grandfather_name_ar', to_jsonb((select grandfather_name_ar from p)), p_data -> 'grandfather_name_ar'
         union all select 'family_name_ar', to_jsonb((select family_name_ar from p)), p_data -> 'family_name_ar'
         union all select 'first_name_en', to_jsonb((select first_name_en from p)), p_data -> 'first_name_en'
         union all select 'father_name_en', to_jsonb((select father_name_en from p)), p_data -> 'father_name_en'
         union all select 'grandfather_name_en', to_jsonb((select grandfather_name_en from p)), p_data -> 'grandfather_name_en'
         union all select 'family_name_en', to_jsonb((select family_name_en from p)), p_data -> 'family_name_en'
         union all select 'mobile_e164', to_jsonb((select mobile_e164 from p)), p_data -> 'mobile'
         union all select 'employee_number', to_jsonb((select employee_number from p)), p_data -> 'employee_number'
         union all select 'job_title_ar', to_jsonb((select job_title_ar from e)), p_data -> 'job_title_ar'
         union all select 'job_title_en', to_jsonb((select job_title_en from e)), p_data -> 'job_title_en'
         union all select 'department_id', to_jsonb((select department_id from e)), to_jsonb(p_department_id)
         union all select 'branch_id', to_jsonb((select branch_id from e)), to_jsonb(p_branch_id)
         union all select 'manager_person_id', to_jsonb((select manager_person_id from e)), to_jsonb(p_manager_person_id)
         union all select 'hire_on', to_jsonb((select hire_on::text from e)), p_data -> 'hire_date')
  , changed as (
    select f.col, coalesce(f.current_value, 'null'::jsonb) as current_value
    from f
    where f.new_value is not null and f.new_value <> 'null'::jsonb and f.new_value is distinct from f.current_value)
  -- The display names are recomposed from the parts when a part changes: undo puts them back as they were.
  select coalesce(jsonb_object_agg(x.col, x.current_value), '{}'::jsonb)
  from (
    select col, current_value from changed
    union all
    select 'display_name_ar', to_jsonb((select display_name_ar from p))
    where exists (select 1 from changed where col like '%\_name\_ar')
    union all
    select 'display_name_en', coalesce(to_jsonb((select display_name_en from p)), 'null'::jsonb)
    where exists (select 1 from changed where col like '%\_name\_en')) x;
$$;
revoke all on function private.user_import_person_before(uuid, uuid, jsonb, uuid, uuid, uuid) from public;
grant execute on function private.user_import_person_before(uuid, uuid, jsonb, uuid, uuid, uuid) to authenticated;

-- Writes `p_values` ({"<column>": value}, persons and placement columns) on the person's record and
-- placement; display names are composed again from the name parts when one changed (design principles
-- §4). Returns the record versions after the write: {"person": n, "employment": n}.
create or replace function private.user_import_write_person(p_tenant_id uuid, p_person_id uuid, p_values jsonb,
                                                            p_status text default null)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_person platform.persons;
  v_employment_values jsonb := p_values - array['first_name_ar', 'father_name_ar', 'grandfather_name_ar',
    'family_name_ar', 'first_name_en', 'father_name_en', 'grandfather_name_en', 'family_name_en', 'mobile_e164',
    'employee_number'];
  v_person_values jsonb := p_values - array['job_title_ar', 'job_title_en', 'department_id', 'branch_id',
    'manager_person_id', 'hire_on'];
  v_employment_version integer;
begin
  if v_person_values <> '{}'::jsonb or p_status is not null then
    update platform.persons p
    set first_name_ar = case when v_person_values ? 'first_name_ar' then v_person_values ->> 'first_name_ar' else p.first_name_ar end,
        father_name_ar = case when v_person_values ? 'father_name_ar' then v_person_values ->> 'father_name_ar' else p.father_name_ar end,
        grandfather_name_ar = case when v_person_values ? 'grandfather_name_ar' then v_person_values ->> 'grandfather_name_ar' else p.grandfather_name_ar end,
        family_name_ar = case when v_person_values ? 'family_name_ar' then v_person_values ->> 'family_name_ar' else p.family_name_ar end,
        first_name_en = case when v_person_values ? 'first_name_en' then v_person_values ->> 'first_name_en' else p.first_name_en end,
        father_name_en = case when v_person_values ? 'father_name_en' then v_person_values ->> 'father_name_en' else p.father_name_en end,
        grandfather_name_en = case when v_person_values ? 'grandfather_name_en' then v_person_values ->> 'grandfather_name_en' else p.grandfather_name_en end,
        family_name_en = case when v_person_values ? 'family_name_en' then v_person_values ->> 'family_name_en' else p.family_name_en end,
        mobile_e164 = case when v_person_values ? 'mobile_e164' then v_person_values ->> 'mobile_e164' else p.mobile_e164 end,
        employee_number = case when v_person_values ? 'employee_number' then v_person_values ->> 'employee_number' else p.employee_number end,
        display_name_ar = case when v_person_values ? 'display_name_ar' then v_person_values ->> 'display_name_ar' else p.display_name_ar end,
        display_name_en = case when v_person_values ? 'display_name_en' then v_person_values ->> 'display_name_en' else p.display_name_en end,
        status = coalesce(p_status, p.status)
    where p.tenant_id = p_tenant_id and p.id = p_person_id
    returning * into v_person;
    if v_person.id is null then
      raise exception 'person not found' using errcode = 'JU002', detail = 'CHANGED_SINCE_REVIEW';
    end if;
    -- Display names follow the parts (only when an Arabic / English part was written and the names were
    -- not given themselves — undo gives them back as they were).
    if v_person_values ?| array['first_name_ar', 'father_name_ar', 'grandfather_name_ar', 'family_name_ar']
       and not v_person_values ? 'display_name_ar' and v_person.first_name_ar is not null then
      update platform.persons p
      set display_name_ar = concat_ws(' ', p.first_name_ar, p.father_name_ar, p.grandfather_name_ar, p.family_name_ar)
      where p.tenant_id = p_tenant_id and p.id = p_person_id
      returning * into v_person;
    end if;
    if v_person_values ?| array['first_name_en', 'father_name_en', 'grandfather_name_en', 'family_name_en']
       and not v_person_values ? 'display_name_en' then
      update platform.persons p
      set display_name_en = nullif(concat_ws(' ', p.first_name_en, p.father_name_en, p.grandfather_name_en, p.family_name_en), '')
      where p.tenant_id = p_tenant_id and p.id = p_person_id
      returning * into v_person;
    end if;
  else
    select * into v_person from platform.persons p where p.tenant_id = p_tenant_id and p.id = p_person_id;
  end if;

  if v_employment_values <> '{}'::jsonb then
    update platform.person_employment e
    set job_title_ar = case when v_employment_values ? 'job_title_ar' then v_employment_values ->> 'job_title_ar' else e.job_title_ar end,
        job_title_en = case when v_employment_values ? 'job_title_en' then v_employment_values ->> 'job_title_en' else e.job_title_en end,
        department_id = case when v_employment_values ? 'department_id' then (v_employment_values ->> 'department_id')::uuid else e.department_id end,
        branch_id = case when v_employment_values ? 'branch_id' then (v_employment_values ->> 'branch_id')::uuid else e.branch_id end,
        manager_person_id = case when v_employment_values ? 'manager_person_id' then (v_employment_values ->> 'manager_person_id')::uuid else e.manager_person_id end,
        hire_on = case when v_employment_values ? 'hire_on' then (v_employment_values ->> 'hire_on')::date else e.hire_on end
    where e.tenant_id = p_tenant_id and e.person_id = p_person_id
    returning e.version into v_employment_version;
    if v_employment_version is null then
      insert into platform.person_employment (person_id, job_title_ar, job_title_en, department_id, branch_id,
                                              manager_person_id, hire_on, source)
      values (p_person_id, v_employment_values ->> 'job_title_ar', v_employment_values ->> 'job_title_en',
              (v_employment_values ->> 'department_id')::uuid, (v_employment_values ->> 'branch_id')::uuid,
              (v_employment_values ->> 'manager_person_id')::uuid, (v_employment_values ->> 'hire_on')::date, 'import')
      returning version into v_employment_version;
    end if;
  else
    select e.version into v_employment_version
    from platform.person_employment e where e.tenant_id = p_tenant_id and e.person_id = p_person_id;
  end if;
  return jsonb_build_object('person', v_person.version, 'employment', v_employment_version);
end
$$;
revoke all on function private.user_import_write_person(uuid, uuid, jsonb, text) from public;
grant execute on function private.user_import_write_person(uuid, uuid, jsonb, text) to authenticated;

-- The run's first phase («مراجعة الصفوف من جديد»): the rows the review would add or update are checked
-- against the organization's data as it is NOW — someone with the e-mail added or invited by hand since,
-- an account deactivated, an employee number taken. Such rows are not written: they become errors with
-- CHANGED_SINCE_REVIEW (and the reason) and go to the error report. Returns how many changed. (What the
-- file says about itself — duplicates, loops — cannot change; departments, branches and managers are
-- checked again as each row is written.)
create or replace function private.user_import_recheck(p_import_id uuid)
returns integer
language plpgsql volatile
set search_path = ''
as $$
declare
  v_tenant uuid := private.user_import_job_tenant();
  v_count integer;
begin
  with now_facts as (
    select r.row_number,
           case
             when r.review_kind = 'new' and r.target_person_id is null
                  and exists (select 1 from platform.persons p where p.tenant_id = v_tenant and p.email = r.data ->> 'email'
                                                                  and p.removed_at is null)
               then 'EMAIL_TAKEN'
             when r.review_kind = 'new' and r.target_person_id is not null
                  and (exists (select 1 from platform.tenant_memberships m
                               where m.tenant_id = v_tenant and m.person_id = r.target_person_id)
                       or exists (select 1 from platform.invitations i
                                  where i.tenant_id = v_tenant and i.person_id = r.target_person_id and i.status = 'pending'))
               then 'INVITATION_PENDING'
             when r.review_kind = 'new'
                  and exists (select 1 from platform.invitations i
                              where i.tenant_id = v_tenant and i.email = r.data ->> 'email' and i.status = 'pending')
               then 'INVITATION_PENDING'
             when r.review_kind = 'existing'
                  and not exists (select 1 from platform.tenant_memberships m
                                  where m.tenant_id = v_tenant and m.person_id = r.target_person_id and m.status = 'active')
               then 'MEMBER_DEACTIVATED'
             when r.data ? 'employee_number'
                  and exists (select 1 from platform.persons p
                              where p.tenant_id = v_tenant and p.employee_number = r.data ->> 'employee_number'
                                and p.removed_at is null and p.id is distinct from r.target_person_id)
               then 'EMPLOYEE_NUMBER_TAKEN'
           end as reason
    from platform.user_import_rows r
    where r.tenant_id = v_tenant and r.import_id = p_import_id and r.review_kind in ('new', 'existing'))
  update platform.user_import_rows r
  set review_kind = 'error',
      issues = r.issues || private.user_import_issue('CHANGED_SINCE_REVIEW', 'e', null,
                                                     jsonb_build_object('reason', f.reason))
  from now_facts f
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = f.row_number
    and f.reason is not null;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
comment on function private.user_import_recheck(uuid) is
  'The fresh check at the start of a user import''s run (T-M2-12): rows that changed since the review become errors. System claims.';
revoke all on function private.user_import_recheck(uuid) from public;
grant execute on function private.user_import_recheck(uuid) to authenticated;

-- One batch of the run: the next `p_limit` rows to add or update after the checkpoint, in order, under the
-- per-tenant locks. Every row is checked again as it is written ("fresh check"): what changed since the
-- review (e.g. the person was invited by hand meanwhile) is recorded on the row, never applied. Returns
-- the number of rows processed (0: nothing left).
create or replace function private.user_import_apply_batch(p_import_id uuid, p_limit integer)
returns integer
language plpgsql volatile
set search_path = ''
as $$
declare
  v_tenant uuid := private.user_import_job_tenant();
  v_import record;
  v_mode text;
  v_default_role text;
  v_admin boolean;
  v_importer_person uuid;
  v_row platform.user_import_rows;
  d jsonb;
  v_count integer := 0;
  v_last integer;
  v_person uuid;
  v_invitation uuid;
  v_manager uuid;
  v_department uuid;
  v_branch uuid;
  v_primary text;
  v_additional text[];
  v_warnings jsonb;
  v_values jsonb;
  v_before jsonb;
  v_versions jsonb;
  v_member text;
  v_state text;
  v_constraint text;
  v_message text;
  v_detail text;
  v_code text;
begin
  select i.id, i.status, i.options, i.created_by, i.checkpoint into v_import
  from platform.user_imports i where i.id = p_import_id for update;
  if not found or v_import.status <> 'importing' then
    raise exception 'the import is not adding people' using errcode = 'check_violation';
  end if;
  perform private.user_import_lock_tenant(v_tenant);
  if not private.user_import_actor_may_import(v_tenant, v_import.created_by) then
    raise exception 'the importer may no longer import people' using errcode = 'JU001';
  end if;
  v_mode := v_import.options ->> 'existing';
  v_default_role := v_import.options ->> 'defaultRole';
  v_admin := 'tenant_admin' = any (private.actor_role_codes(v_tenant, v_import.created_by));
  select m.person_id into v_importer_person
  from platform.tenant_memberships m where m.tenant_id = v_tenant and m.user_id = v_import.created_by;

  for v_row in
    select r.* from platform.user_import_rows r
    where r.tenant_id = v_tenant and r.import_id = p_import_id and r.apply_order > v_import.checkpoint
      and r.review_kind in ('new', 'existing') and r.result is null
    order by r.apply_order
    limit greatest(1, least(coalesce(p_limit, 500), 1000))
  loop
    v_count := v_count + 1;
    v_last := v_row.apply_order;
    d := v_row.data;
    -- The review's warnings stay with the row (the error report lists them).
    v_warnings := coalesce((select jsonb_agg(i) from jsonb_array_elements(v_row.issues) i where i ->> 's' = 'w'),
                           '[]'::jsonb);
    begin
      if v_row.review_kind = 'new' and v_mode = 'update_only' then
        update platform.user_import_rows r
        set result = 'skipped', result_issues = private.user_import_issue('NEW_SKIPPED_UPDATE_ONLY', 'k')
        where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
      elsif v_row.review_kind = 'existing' and v_mode = 'skip' then
        update platform.user_import_rows r
        set result = 'skipped', result_issues = private.user_import_issue('EXISTING_SKIPPED', 'k')
        where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
      else
        -- References as they are now: the manager added by an earlier row, units not deleted since, a
        -- manager still active. A reference that no longer holds is left empty (warning).
        v_manager := v_row.manager_person_id;
        if v_row.manager_row is not null then
          select m.person_id into v_manager from platform.user_import_rows m
          where m.tenant_id = v_tenant and m.import_id = p_import_id and m.row_number = v_row.manager_row
            and m.result in ('added', 'updated');
        end if;
        if v_manager is not null and not exists (select 1 from platform.persons p
                                                 where p.tenant_id = v_tenant and p.id = v_manager and p.status = 'active') then
          v_manager := null;
        end if;
        if v_manager is null and (v_row.manager_row is not null or v_row.manager_person_id is not null) then
          v_warnings := v_warnings || private.user_import_issue('MANAGER_NOT_FOUND', 'w', 'manager_email',
                                                                jsonb_build_object('email', d ->> 'manager_email'));
        end if;
        v_department := v_row.department_id;
        if v_department is not null and not exists (select 1 from platform.departments x
                                                     where x.tenant_id = v_tenant and x.id = v_department and x.deleted_at is null) then
          v_department := null;
          v_warnings := v_warnings || private.user_import_issue('DEPARTMENT_NOT_FOUND', 'w', 'department',
                                                                jsonb_build_object('name', d ->> 'department'));
        end if;
        v_branch := v_row.branch_id;
        if v_branch is not null and not exists (select 1 from platform.branches x
                                                where x.tenant_id = v_tenant and x.id = v_branch and x.deleted_at is null) then
          v_branch := null;
          v_warnings := v_warnings || private.user_import_issue('BRANCH_NOT_FOUND', 'w', 'branch',
                                                                jsonb_build_object('name', d ->> 'branch'));
        end if;

        if v_row.review_kind = 'new' then
          v_primary := coalesce(d ->> 'primary_role', v_default_role);
          v_additional := array(select distinct a from jsonb_array_elements_text(coalesce(d -> 'additional_roles', '[]')) a
                                where a <> v_primary order by a);
          if v_row.target_person_id is null then
            -- Fresh check: nobody has this e-mail now (e.g. invited by hand since the review).
            if exists (select 1 from platform.persons p where p.tenant_id = v_tenant and p.email = d ->> 'email'
                                                         and p.removed_at is null) then
              raise exception 'changed since the review' using errcode = 'JU002', detail = 'CHANGED_SINCE_REVIEW';
            end if;
            insert into platform.persons (display_name_ar, display_name_en, first_name_ar, father_name_ar,
                                          grandfather_name_ar, family_name_ar, first_name_en, father_name_en,
                                          grandfather_name_en, family_name_en, email, employee_number, mobile_e164,
                                          preferred_locale)
            values (concat_ws(' ', d ->> 'first_name_ar', d ->> 'father_name_ar', d ->> 'grandfather_name_ar', d ->> 'family_name_ar'),
                    nullif(concat_ws(' ', d ->> 'first_name_en', d ->> 'father_name_en', d ->> 'grandfather_name_en', d ->> 'family_name_en'), ''),
                    d ->> 'first_name_ar', d ->> 'father_name_ar', d ->> 'grandfather_name_ar', d ->> 'family_name_ar',
                    d ->> 'first_name_en', d ->> 'father_name_en', d ->> 'grandfather_name_en', d ->> 'family_name_en',
                    d ->> 'email', d ->> 'employee_number', d ->> 'mobile', coalesce(d ->> 'language', 'ar'))
            returning id into v_person;
            insert into platform.person_employment (person_id, department_id, branch_id, manager_person_id, job_title_ar,
                                                    job_title_en, hire_on, source)
            values (v_person, v_department, v_branch, v_manager, d ->> 'job_title_ar', d ->> 'job_title_en',
                    (d ->> 'hire_date')::date, 'import');
            v_before := null;
            v_versions := null;
          else
            -- A person without account or invitation (e.g. whose invitation was revoked by hand; never one
            -- removed by an undo — those are not matched): invited again, the record updated from the file
            -- and made active; undo restores it.
            perform 1 from platform.persons p where p.tenant_id = v_tenant and p.id = v_row.target_person_id for update;
            select m.status into v_member from platform.tenant_memberships m
            where m.tenant_id = v_tenant and m.person_id = v_row.target_person_id;
            if v_member is not null
               or exists (select 1 from platform.invitations i
                          where i.tenant_id = v_tenant and i.person_id = v_row.target_person_id and i.status = 'pending')
               or not exists (select 1 from platform.persons p
                              where p.tenant_id = v_tenant and p.id = v_row.target_person_id and p.email = d ->> 'email') then
              raise exception 'changed since the review' using errcode = 'JU002', detail = 'CHANGED_SINCE_REVIEW';
            end if;
            v_person := v_row.target_person_id;
            v_values := private.user_import_person_before(v_tenant, v_person, d, v_department, v_branch, v_manager);
            v_before := v_values || jsonb_build_object('status', (select p.status from platform.persons p
                                                                   where p.tenant_id = v_tenant and p.id = v_person));
            select coalesce(jsonb_object_agg(k.key, case k.key
                     when 'mobile_e164' then d -> 'mobile' when 'hire_on' then d -> 'hire_date'
                     when 'department_id' then to_jsonb(v_department) when 'branch_id' then to_jsonb(v_branch)
                     when 'manager_person_id' then to_jsonb(v_manager) else d -> k.key end), '{}'::jsonb)
              into v_values
            from jsonb_object_keys(v_values) k(key)
            where k.key not like 'display\_name\_%';
            v_versions := private.user_import_write_person(v_tenant, v_person, v_values, 'active');
          end if;
          -- The trigger makes the importer the inviter (checked: may still invite; no privileged role).
          insert into platform.invitations (person_id, email, locale, primary_role, additional_roles, import_id, mail_held)
          values (v_person, d ->> 'email', coalesce(d ->> 'language', 'ar'), v_primary, v_additional, p_import_id, true)
          returning id into v_invitation;
          insert into platform.audit_events (action, entity_type, entity_id, data)
          values ('platform.invitation.created', 'invitation', v_invitation::text,
                  jsonb_build_object('personId', v_person, 'primaryRole', v_primary, 'additionalRoles', to_jsonb(v_additional),
                                     'importId', p_import_id, 'held', true, 'reinvited', v_row.target_person_id is not null,
                                     'job', private.request_claims() ->> 'job_id'));
          update platform.user_import_rows r
          set result = 'added', result_issues = v_warnings, person_id = v_person, invitation_id = v_invitation,
              before = v_before, after_versions = v_versions
          where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
        else
          -- An existing member: their data only (never e-mail, roles or account status: PO decisions 4, 5).
          v_person := v_row.target_person_id;
          perform 1 from platform.persons p where p.tenant_id = v_tenant and p.id = v_person for update;
          select m.status into v_member from platform.tenant_memberships m
          where m.tenant_id = v_tenant and m.person_id = v_person;
          if v_member is distinct from 'active' then
            raise exception 'changed since the review' using errcode = 'JU002', detail = 'CHANGED_SINCE_REVIEW';
          end if;
          if v_person = v_importer_person then
            raise exception 'own record' using errcode = 'JU002', detail = 'OWN_ROW';
          end if;
          -- An HR Manager never changes the record of a member holding a privileged role (TM-0003
          -- T-IAM-18; as «تعديل البيانات»): skipped.
          if not v_admin and exists (select 1 from platform.tenant_memberships m
                                     where m.tenant_id = v_tenant and m.person_id = v_person
                                       and private.membership_is_privileged(m.tenant_id, m.id)) then
            update platform.user_import_rows r
            set result = 'skipped', result_issues = private.user_import_issue('PRIVILEGED_MEMBER', 'k')
            where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
          else
            v_before := private.user_import_person_before(v_tenant, v_person, d, v_department, v_branch, v_manager);
            if v_before = '{}'::jsonb then
              update platform.user_import_rows r
              set result = 'skipped', result_issues = private.user_import_issue('NO_CHANGES', 'k') || v_warnings
              where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
            else
              select coalesce(jsonb_object_agg(k.key, case k.key
                       when 'mobile_e164' then d -> 'mobile' when 'hire_on' then d -> 'hire_date'
                       when 'department_id' then to_jsonb(v_department) when 'branch_id' then to_jsonb(v_branch)
                       when 'manager_person_id' then to_jsonb(v_manager) else d -> k.key end), '{}'::jsonb)
                into v_values
              from jsonb_object_keys(v_before) k(key)
              where k.key not like 'display\_name\_%';
              v_versions := private.user_import_write_person(v_tenant, v_person, v_values, null);
              insert into platform.audit_events (action, entity_type, entity_id, data)
              values ('platform.user.updated', 'person', v_person::text,
                      jsonb_build_object('changed', (select jsonb_agg(k order by k) from jsonb_object_keys(v_before) k
                                                     where k not like 'display\_name\_%'),
                                         'importId', p_import_id, 'job', private.request_claims() ->> 'job_id'));
              update platform.user_import_rows r
              set result = 'updated', result_issues = v_warnings, person_id = v_person, before = v_before,
                  after_versions = v_versions
              where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
            end if;
          end if;
        end if;
      end if;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name, v_message = message_text,
                              v_detail = pg_exception_detail;
      v_code := case
        when v_state = 'JU002' then coalesce(nullif(v_detail, ''), 'CHANGED_SINCE_REVIEW')
        when v_state = '23505' and v_constraint = 'persons_tenant_employee_number_uq' then 'EMPLOYEE_NUMBER_TAKEN'
        when v_state = '23505' then 'CHANGED_SINCE_REVIEW'
        when v_state = 'JR001' then 'ROLE_ORG_ADMIN'
        when v_state = '23514' and v_message like '%manager chain%' then 'MANAGER_LOOP'
        when v_state = '23514' and v_message like '%direct manager must be an active person%' then 'MANAGER_NOT_FOUND'
        when v_state = '42501' then 'NOT_ALLOWED'
        else 'WRITE_FAILED'
      end;
      update platform.user_import_rows r
      set result = case when v_code = 'OWN_ROW' then 'skipped' else 'failed' end,
          result_issues = private.user_import_issue(v_code, case when v_code = 'OWN_ROW' then 'k' else 'e' end)
      where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
    end;
  end loop;

  if v_count > 0 then
    update platform.user_imports i
    set checkpoint = v_last, rows_done = least(i.rows_total, i.rows_done + v_count)
    where i.id = p_import_id;
  end if;
  return v_count;
end
$$;

comment on function private.user_import_apply_batch(uuid, integer) is
  'SECURITY-RELEVANT (FR-IAM-04, T-M2-12). One batch of a user import''s run: adds people with held invitations of the importer and updates existing members'' data, each row checked again. System claims of the import''s tenant.';
revoke all on function private.user_import_apply_batch(uuid, integer) from public;
grant execute on function private.user_import_apply_batch(uuid, integer) to authenticated;

-- The result of every row the run did not write: errors and skipped rows as the review said (or as the
-- fresh check found), and rows left when the run stopped or failed (not processed).
create or replace function private.user_import_finish_rows(p_import_id uuid)
returns void
language plpgsql volatile
set search_path = ''
as $$
declare
  v_tenant uuid := private.user_import_job_tenant();
begin
  update platform.user_import_rows r
  set result = 'failed',
      result_issues = coalesce((select jsonb_agg(i) from jsonb_array_elements(r.issues) i where i ->> 's' in ('e', 'w')), '[]'::jsonb)
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.result is null and r.review_kind = 'error';
  update platform.user_import_rows r
  set result = 'skipped',
      result_issues = coalesce((select jsonb_agg(i) from jsonb_array_elements(r.issues) i where i ->> 's' in ('k', 'w')), '[]'::jsonb)
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.result is null and r.review_kind = 'skip';
  update platform.user_import_rows r
  set result = 'not_processed', result_issues = private.user_import_issue('NOT_PROCESSED', 'e')
  where r.tenant_id = v_tenant and r.import_id = p_import_id and r.result is null;
end
$$;
revoke all on function private.user_import_finish_rows(uuid) from public;
grant execute on function private.user_import_finish_rows(uuid) to authenticated;

-- Numbers for the result screen and the audit record (no row data).
create or replace function private.user_import_result_counts(p_import_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  with r as (
    select * from platform.user_import_rows
    where tenant_id = (select private.user_import_job_tenant()) and import_id = p_import_id),
  codes as (
    select r.result, i ->> 'c' as code, count(distinct r.row_number) as n
    from r, jsonb_array_elements(coalesce(r.result_issues, '[]')) i
    where (r.result in ('failed', 'not_processed') and i ->> 's' = 'e')
       or (r.result = 'skipped' and i ->> 's' = 'k')
       or (r.result in ('added', 'updated') and i ->> 's' = 'w')
    group by 1, 2)
  select jsonb_build_object(
    'total', (select count(*) from r),
    'added', (select count(*) from r where result = 'added'),
    'addedWithWarnings', (select count(*) from r where result = 'added' and result_issues @> '[{"s": "w"}]'),
    'reinvited', (select count(*) from r where result = 'added' and before is not null),
    'updated', (select count(*) from r where result = 'updated'),
    'skipped', (select count(*) from r where result = 'skipped'),
    'skippedExisting', (select count(*) from r where result = 'skipped' and result_issues @> '[{"c": "EXISTING_SKIPPED"}]'),
    'failed', (select count(*) from r where result in ('failed', 'not_processed')),
    'notProcessed', (select count(*) from r where result = 'not_processed'),
    'changedSinceReview', (select count(*) from r where reviewed_kind is distinct from review_kind),
    'warned', (select count(*) from r where result in ('added', 'updated') and result_issues @> '[{"s": "w"}]'),
    'failedCodes', coalesce((select jsonb_object_agg(code, n) from codes where result in ('failed', 'not_processed')), '{}'::jsonb),
    'skippedCodes', coalesce((select jsonb_object_agg(code, n) from codes where result = 'skipped'), '{}'::jsonb),
    'warningCodes', coalesce((select jsonb_object_agg(code, n) from codes where result in ('added', 'updated')), '{}'::jsonb));
$$;
revoke all on function private.user_import_result_counts(uuid) from public;
grant execute on function private.user_import_result_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Sending the invitations
-- ---------------------------------------------------------------------------------------------------
-- Sends the next held invitation of the import whose time has come — ONE per call (security review M2):
-- only when the platform-wide send clock gives a slot (private.take_invitation_send_slot: imports of every
-- organization share the e-mail provider's rate, and overdue invitations are spaced out again instead of
-- going out in a burst) and the organization is under its daily number of import invitations. Returns:
--   released     one was sent: released (stamped released_at) and announced (`invitation.released`: the
--                mailer gives it a token and e-mails it);
--   wait         the next slot comes at not_before; the import's next attempt is moved there;
--   capped       the organization sent its daily number of import invitations today (UTC day): the import
--                waits until not_before (the next day). Its invitations stay scheduled — never dropped;
--   none         nothing due;
--   not_allowed  the member the next invitation is sent for — who asked to send it from the users list,
--                else the importer — may no longer invite (integration review M2): the import's invitations
--                scheduled for that member are cleared (they stay «لم تُرسل الدعوة»), and a user manager can
--                send them from the users list: they are then sent for that manager.
-- Each release is audited (`platform.invitation.released`, by the job) with the member it is sent for and
-- who asked, so the member who caused the e-mail is accountable (TM-0003 T-IAM-45).
-- p_interval: the pace (worker setting); p_daily_cap, p_trial_daily_cap: the daily numbers for
-- organizations in service and on trial (worker settings). System claims of the import's tenant.
create or replace function private.user_import_release_next(p_import_id uuid, p_interval interval,
                                                           p_daily_cap integer, p_trial_daily_cap integer)
returns table (state text, not_before timestamptz)
language plpgsql volatile
set search_path = ''
as $$
declare
  v_tenant uuid := private.user_import_job_tenant();
  v_importer uuid;
  v_actor uuid;
  v_requested_by uuid;
  v_primary text;
  v_additional text[];
  v_trial boolean;
  v_cap integer;
  v_sent integer;
  v_invitation uuid;
  v_next_day timestamptz := date_trunc('day', now(), 'UTC') + interval '1 day';
  v_slot timestamptz;
begin
  if p_daily_cap is null or p_daily_cap < 1 or p_trial_daily_cap is null or p_trial_daily_cap < 1 then
    raise exception 'invalid daily number of invitations' using errcode = 'invalid_parameter_value';
  end if;
  select i.created_by into v_importer from platform.user_imports i where i.id = p_import_id;
  if not found then
    raise exception 'unknown import' using errcode = 'no_data_found';
  end if;
  -- The per-tenant roles lock: the sender's right, and the daily count, are read once per organization at
  -- a time.
  perform private.lock_tenant_roles(v_tenant);
  select i.id, i.send_requested_by, coalesce(i.send_requested_by, v_importer), i.primary_role, i.additional_roles
    into v_invitation, v_requested_by, v_actor, v_primary, v_additional
  from platform.invitations i
  where i.tenant_id = v_tenant and i.import_id = p_import_id and i.mail_held and i.status = 'pending'
    and i.send_at <= now()
  order by i.send_at, i.id
  limit 1
  for update skip locked;
  if v_invitation is null then
    return query select 'none'::text, null::timestamptz;
    return;
  end if;
  -- Sent for the member who asked, else the importer, while they may invite (integration review M2).
  if not private.invitation_actor_may_send(v_tenant, v_actor, v_primary, v_additional) then
    update platform.invitations i set send_at = null
    where i.tenant_id = v_tenant and i.import_id = p_import_id and i.mail_held and i.send_at is not null
      and i.status = 'pending' and coalesce(i.send_requested_by, v_importer) = v_actor;
    return query select 'not_allowed'::text, null::timestamptz;
    return;
  end if;
  select t.status = 'trial' into v_trial from platform.tenants t where t.id = v_tenant;
  v_cap := case when coalesce(v_trial, false) then p_trial_daily_cap else p_daily_cap end;
  select count(*) into v_sent
  from (select 1 from platform.invitations i
        where i.tenant_id = v_tenant and i.released_at >= v_next_day - interval '1 day'
        limit v_cap) x;
  if v_sent >= v_cap then
    update platform.user_imports i set next_attempt_at = v_next_day where i.id = p_import_id;
    return query select 'capped'::text, v_next_day;
    return;
  end if;
  v_slot := private.take_invitation_send_slot(p_interval);
  if v_slot is not null then
    update platform.user_imports i set next_attempt_at = v_slot where i.id = p_import_id;
    return query select 'wait'::text, v_slot;
    return;
  end if;
  update platform.invitations i set mail_held = false where i.id = v_invitation;
  insert into platform.event_outbox (id, type, subject)
  values (gen_random_uuid(), 'com.entlaqa.platform.invitation.released', v_invitation);
  insert into platform.audit_events (action, entity_type, entity_id, data)
  values ('platform.invitation.released', 'invitation', v_invitation::text,
          jsonb_build_object('importId', p_import_id, 'sentFor', v_actor, 'requestedBy', v_requested_by,
                             'job', private.request_claims() ->> 'job_id'));
  return query select 'released'::text, null::timestamptz;
end
$$;
comment on function private.user_import_release_next(uuid, interval, integer, integer) is
  'SECURITY-RELEVANT (FR-IAM-03, T-M2-12, security review M2, integration review M2). Sends the next due held invitation of an import (released + event for the mailer + audit) at the platform-wide pace and under the organization''s daily number, while the member it is sent for (who asked, else the importer) may still invite. System claims.';
revoke all on function private.user_import_release_next(uuid, interval, integer, integer) from public;
grant execute on function private.user_import_release_next(uuid, interval, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Undo (BRD §10.4, PO decision 10)
-- ---------------------------------------------------------------------------------------------------
-- One batch of an undo: the next `p_limit` rows the import added or updated (people who report to
-- others first). Added people who have not accepted their invitation are removed from the organization:
-- their invitation revoked (the link stops at once) and, for a record the import created, the record
-- removed as if never added (migration 20261016090150) — or, for a record the import invited again, put
-- back as it was. People who accepted stay; so do people someone else now reports to, or who head a
-- department (reassign first). Updated people get their previous values back unless their record changed
-- since; so does a record invited again (security review L1: kept as it is when changed since).
-- The member who asked for the undo must still be allowed to undo it — its importer who may still
-- import, or an Organization Admin (private.user_import_actor_may_undo) — read again for every batch
-- (security review L1); otherwise -1 is returned and nothing changes (the worker ends the undo). When they
-- are not an Organization Admin, members who hold a privileged role now keep their data (kept_privileged:
-- an HR Manager never changes such a record, TM-0003 T-IAM-18). Returns the number of rows processed
-- (0: nothing left).
create or replace function private.user_import_undo_batch(p_import_id uuid, p_limit integer)
returns integer
language plpgsql volatile
set search_path = ''
as $$
declare
  v_tenant uuid := private.user_import_job_tenant();
  v_import record;
  v_admin boolean;
  v_row platform.user_import_rows;
  v_count integer := 0;
  v_result text;
  v_status text;
  v_versions jsonb;
  v_restore jsonb;
begin
  select i.id, i.status, i.created_by, i.undo_requested_by into v_import
  from platform.user_imports i where i.id = p_import_id for update;
  if not found or v_import.status <> 'undoing' then
    raise exception 'the import is not being undone' using errcode = 'check_violation';
  end if;
  perform private.user_import_lock_tenant(v_tenant);
  if not private.user_import_actor_may_undo(v_tenant, v_import.undo_requested_by, v_import.created_by) then
    return -1;
  end if;
  v_admin := 'tenant_admin' = any (private.actor_role_codes(v_tenant, v_import.undo_requested_by));
  for v_row in
    select r.* from platform.user_import_rows r
    where r.tenant_id = v_tenant and r.import_id = p_import_id and r.result in ('added', 'updated')
      and r.undo_result is null
    order by r.apply_order desc
    limit greatest(1, least(coalesce(p_limit, 500), 1000))
  loop
    v_count := v_count + 1;
    begin
      v_versions := null;
      if v_row.person_id is not null then
        select jsonb_build_object('person', p.version, 'employment', e.version) into v_versions
        from platform.persons p
        left join platform.person_employment e on e.tenant_id = p.tenant_id and e.person_id = p.id
        where p.tenant_id = v_tenant and p.id = v_row.person_id
        for update of p;
      end if;
      if v_row.result = 'added' then
        select i.status into v_status from platform.invitations i
        where i.tenant_id = v_tenant and i.id = v_row.invitation_id for update;
        if v_status is distinct from 'pending'
           or exists (select 1 from platform.tenant_memberships m
                      where m.tenant_id = v_tenant and m.person_id = v_row.person_id) then
          v_result := 'kept_accepted';
        elsif exists (select 1 from platform.person_employment e
                      join platform.persons p on p.tenant_id = e.tenant_id and p.id = e.person_id and p.status = 'active'
                      where e.tenant_id = v_tenant and e.manager_person_id = v_row.person_id
                        and e.person_id <> v_row.person_id)
              or exists (select 1 from platform.departments x
                         where x.tenant_id = v_tenant and x.head_person_id = v_row.person_id and x.deleted_at is null) then
          v_result := 'kept_referenced';
        elsif v_row.before is not null and v_versions is distinct from v_row.after_versions then
          -- Invited again by the import, and the record changed since: kept as it is (invitation included).
          v_result := 'kept_changed';
        else
          update platform.invitations i set status = 'revoked'
          where i.tenant_id = v_tenant and i.id = v_row.invitation_id;
          if v_row.before is null then
            -- Created by this import: removed, as if never added (migration 20261016090150) — kept inactive for
            -- the audit trail and referential integrity only, invisible to user claims.
            update platform.persons p set status = 'inactive', removed_by_import_id = p_import_id
            where p.tenant_id = v_tenant and p.id = v_row.person_id;
          else
            perform private.user_import_write_person(v_tenant, v_row.person_id, v_row.before - 'status',
                                                     coalesce(v_row.before ->> 'status', 'inactive'));
          end if;
          insert into platform.audit_events (action, entity_type, entity_id, data)
          values ('platform.invitation.revoked', 'invitation', v_row.invitation_id::text,
                  jsonb_build_object('personId', v_row.person_id, 'importId', p_import_id, 'undo', true,
                                     'job', private.request_claims() ->> 'job_id'));
          v_result := 'removed';
        end if;
      elsif not v_admin and exists (select 1 from platform.tenant_memberships m
                                    where m.tenant_id = v_tenant and m.person_id = v_row.person_id
                                      and private.membership_is_privileged(m.tenant_id, m.id)) then
        v_result := 'kept_privileged';
      elsif v_versions is distinct from v_row.after_versions then
        v_result := 'kept_changed';
      else
        v_restore := v_row.before;
        perform private.user_import_write_person(v_tenant, v_row.person_id, v_restore, null);
        insert into platform.audit_events (action, entity_type, entity_id, data)
        values ('platform.user.updated', 'person', v_row.person_id::text,
                jsonb_build_object('changed', (select jsonb_agg(k order by k) from jsonb_object_keys(v_restore) k
                                               where k not like 'display\_name\_%'),
                                   'importId', p_import_id, 'undo', true, 'job', private.request_claims() ->> 'job_id'));
        v_result := 'restored';
      end if;
    exception when others then
      v_result := 'kept_error';
    end;
    update platform.user_import_rows r set undo_result = v_result
    where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
  end loop;
  return v_count;
end
$$;
comment on function private.user_import_undo_batch(uuid, integer) is
  'SECURITY-RELEVANT (FR-IAM-04, BRD §10.4, T-M2-12, security review L1). One batch of undoing a user import, while the member who asked may still undo it (-1 otherwise). System claims of the import''s tenant.';
revoke all on function private.user_import_undo_batch(uuid, integer) from public;
grant execute on function private.user_import_undo_batch(uuid, integer) to authenticated;
