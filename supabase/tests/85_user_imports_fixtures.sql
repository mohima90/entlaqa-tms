-- db-test: run-as=owner
-- User import fixtures (T-M2-12, FR-IAM-04) for 86_user_imports_app_server.sql, 87_user_imports_app_worker.sql
-- and 88_user_imports_flow_owner.sql, committed as platform operations. People of tenant A the dry run
-- meets (e-mails @imp.test):
--   exist@imp.test   uExist, active member (learner), employee number IMP-100, OPS, «محاسب»
--   priv@imp.test    uPriv, active member holding a privileged role (finance_manager), number IMP-200
--   deact@imp.test   uDeact, deactivated member (membership suspended, person inactive)
--   pend@imp.test    no membership, pending invitation (by uA)
--   noacc@imp.test   no membership, no invitation, inactive (e.g. removed by an earlier undo)
--   mgr@imp.test     uMgr, active member (learner): a manager the file can name
-- Departments of A: SAL «المبيعات» and SAL2 «المبيعات» (the same name twice), plus the existing TD, OPS.
-- Imports of tenant A (uA = Organization Admin, uAB = HR Manager):
--   a5…01 review (00_helpers_and_fixtures.sql)   a5…10 mapping, uA      a5…11 finished yesterday, uA
--   a5…12 finished 8 days ago, uA                 a5…13 stopped 2 days ago, uA   a5…14 review, uAB (HR)
--   a5…18 finished yesterday, uAB (HR)
-- No import runs (queued … inviting, undoing): the tests start one where they need it.
-- held@imp.test: a person added by a5…11 whose invitation is held (not sent: no token, no schedule).
-- uM (member without a role, 35_invitations_fixtures.sql) gets a session in tenant A.
-- Helper tests.import_file() creates an import's clean uploaded file (owner only).
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000c01', 'exist@imp.test'),
  ('00000000-0000-4000-8000-000000000c02', 'priv@imp.test'),
  ('00000000-0000-4000-8000-000000000c03', 'deact@imp.test'),
  ('00000000-0000-4000-8000-000000000c06', 'mgr@imp.test');

insert into platform.persons (id, tenant_id, display_name_ar, email, employee_number, first_name_ar, family_name_ar, status) values
  ('a1000000-0000-4000-8000-000000000c01', 'a0000000-0000-4000-8000-000000000001', 'موجود قديم', 'exist@imp.test', 'IMP-100', 'موجود', 'قديم', 'active'),
  ('a1000000-0000-4000-8000-000000000c02', 'a0000000-0000-4000-8000-000000000001', 'مميز', 'priv@imp.test', 'IMP-200', null, null, 'active'),
  ('a1000000-0000-4000-8000-000000000c03', 'a0000000-0000-4000-8000-000000000001', 'معطل', 'deact@imp.test', null, null, null, 'inactive'),
  ('a1000000-0000-4000-8000-000000000c04', 'a0000000-0000-4000-8000-000000000001', 'مدعو منتظر', 'pend@imp.test', null, null, null, 'active'),
  ('a1000000-0000-4000-8000-000000000c05', 'a0000000-0000-4000-8000-000000000001', 'بلا حساب', 'noacc@imp.test', null, 'بلا', 'حساب', 'inactive'),
  ('a1000000-0000-4000-8000-000000000c06', 'a0000000-0000-4000-8000-000000000001', 'مدير القسم', 'mgr@imp.test', null, null, null, 'active');

insert into platform.tenant_memberships (tenant_id, user_id, person_id, status) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c01', 'a1000000-0000-4000-8000-000000000c01', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c02', 'a1000000-0000-4000-8000-000000000c02', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c03', 'a1000000-0000-4000-8000-000000000c03', 'suspended'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c06', 'a1000000-0000-4000-8000-000000000c06', 'active');
insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
select m.tenant_id, m.id, r.role_code, true
from (values ('00000000-0000-4000-8000-000000000c01'::uuid, 'learner'),
             ('00000000-0000-4000-8000-000000000c02', 'finance_manager'),
             ('00000000-0000-4000-8000-000000000c03', 'learner'),
             ('00000000-0000-4000-8000-000000000c06', 'learner')) r (user_id, role_code)
join platform.tenant_memberships m on m.tenant_id = 'a0000000-0000-4000-8000-000000000001' and m.user_id = r.user_id;

insert into platform.departments (id, tenant_id, code, name_ar, name_en, branch_id) values
  ('a3000000-0000-4000-8000-000000000c01', 'a0000000-0000-4000-8000-000000000001', 'SAL', 'المبيعات', 'Sales', null),
  ('a3000000-0000-4000-8000-000000000c02', 'a0000000-0000-4000-8000-000000000001', 'SAL2', 'المبيعات', 'Sales 2', null);
insert into platform.person_employment (tenant_id, person_id, department_id, job_title_ar) values
  ('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c01', 'a3000000-0000-4000-8000-000000000003', 'محاسب');

insert into platform.invitations (id, tenant_id, person_id, email, locale, primary_role, invited_by) values
  ('a4000000-0000-4000-8000-000000000c04', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c04',
   'pend@imp.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000a1');

-- The clean uploaded file of an import (as the scan leaves it), owned by its importer. Owner only.
create or replace function tests.import_file(p_import uuid, p_tenant uuid, p_user uuid, p_file uuid,
                                             p_name text default 'staff.csv', p_status text default 'clean')
returns uuid
language plpgsql as $$
declare
  v_clean boolean := p_status = 'clean';
begin
  alter table platform.files disable trigger files_transition;
  insert into platform.files (id, tenant_id, bucket, object_key, purpose, owner_module, owner_entity_type, owner_entity_id,
      original_name, declared_mime, declared_size, detected_mime, size_bytes, sha256, status, scan_engine, scan_signatures,
      scanned_at, retention_class, created_by_user, upload_expires_at, uploaded_at)
  values (p_file, p_tenant, 'imports', p_tenant::text || '/platform/user_import/' || p_import::text || '/' || p_file::text,
      'platform.user_import', 'platform', 'user_import', p_import, p_name, 'text/csv', 100,
      case when v_clean then 'text/csv' end, case when v_clean then 100 end, case when v_clean then repeat('c', 64) end,
      p_status, case when v_clean then 'ClamAV 1.5.4' end, case when v_clean then '28137' end,
      case when v_clean then now() end, 'import', p_user, now() + interval '15 minutes',
      case when p_status <> 'pending_upload' then now() end);
  alter table platform.files enable trigger files_transition;
  return p_file;
end $$;
revoke all on function tests.import_file(uuid, uuid, uuid, uuid, text, text) from public;

select tests.import_file('a5000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000001',
                         '00000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-000000000010');
select tests.import_file('a5000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001',
                         '00000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-000000000011');
select tests.import_file('a5000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000001',
                         '00000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-000000000012');
select tests.import_file('a5000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000001',
                         '00000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-000000000013');
select tests.import_file('a5000000-0000-4000-8000-000000000014', 'a0000000-0000-4000-8000-000000000001',
                         '00000000-0000-4000-8000-0000000000ab', 'f0a00000-0000-4000-8000-000000000014');
select tests.import_file('a5000000-0000-4000-8000-000000000018', 'a0000000-0000-4000-8000-000000000001',
                         '00000000-0000-4000-8000-0000000000ab', 'f0a00000-0000-4000-8000-000000000018');

-- Platform operations: the lifecycle trigger stamps nothing for them (times written here).
insert into platform.user_imports (id, tenant_id, created_by, created_by_person, file_id, file_name, file_size, status,
    sheets, sheet_index, mapping, options, review_counts, rows_total, rows_done, confirmed_at, finished_at) values
  ('a5000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
   'a1000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-000000000010', 'staff.csv', 100, 'mapping',
   '[{"name": "", "rows": 3, "columns": 3}]', null, null, null, null, 0, 0, null, null),
  ('a5000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
   'a1000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-000000000011', 'staff.csv', 100, 'finished',
   '[{"name": "", "rows": 3, "columns": 3}]', 0, '{"0": "email", "1": "first_name_ar", "2": "family_name_ar"}',
   '{"existing": "skip", "defaultRole": "learner", "invitations": "hold"}', '{"new": 1}', 1, 1,
   now() - interval '1 day 1 hour', now() - interval '1 day'),
  ('a5000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
   'a1000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-000000000012', 'old.csv', 100, 'finished',
   '[{"name": "", "rows": 3, "columns": 3}]', 0, '{"0": "email", "1": "first_name_ar", "2": "family_name_ar"}',
   '{"existing": "skip", "defaultRole": "learner", "invitations": "send"}', '{"new": 1}', 1, 1,
   now() - interval '8 days 1 hour', now() - interval '8 days'),
  ('a5000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
   'a1000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-000000000013', 'stopped.csv', 100, 'stopped',
   '[{"name": "", "rows": 3, "columns": 3}]', 0, '{"0": "email", "1": "first_name_ar", "2": "family_name_ar"}',
   '{"existing": "skip", "defaultRole": "learner", "invitations": "send"}', '{"new": 1}', 1, 1,
   now() - interval '2 days 1 hour', now() - interval '2 days'),
  ('a5000000-0000-4000-8000-000000000014', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ab',
   'a1000000-0000-4000-8000-0000000000ab', 'f0a00000-0000-4000-8000-000000000014', 'hr.csv', 100, 'review',
   '[{"name": "", "rows": 3, "columns": 3}]', 0, '{"0": "email", "1": "first_name_ar", "2": "family_name_ar"}',
   null, '{"new": 1}', 1, 0, null, null),
  ('a5000000-0000-4000-8000-000000000018', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ab',
   'a1000000-0000-4000-8000-0000000000ab', 'f0a00000-0000-4000-8000-000000000018', 'hr-done.csv', 100, 'finished',
   '[{"name": "", "rows": 3, "columns": 3}]', 0, '{"0": "email", "1": "first_name_ar", "2": "family_name_ar"}',
   '{"existing": "skip", "defaultRole": "learner", "invitations": "hold"}', '{"new": 1}', 1, 1,
   now() - interval '1 day 2 hours', now() - interval '1 day');
insert into platform.user_import_columns (tenant_id, import_id, sheet_index, column_index, header, samples) values
  ('a0000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000010', 0, 0, 'Email', '{x@imp.test}'),
  ('a0000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000014', 0, 0, 'Email', '{hr@imp.test}');
insert into platform.user_import_rows (tenant_id, import_id, row_number, cells, data, review_kind) values
  ('a0000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000014', 2, '{"email": "hr@imp.test"}',
   '{"email": "hr@imp.test"}', 'new');

-- For the worker's claim (87_user_imports_app_worker.sql): a5…15 uploaded, its file clean (read);
-- a5…16 uploaded, its file not uploaded yet (waits); a5…17 mapping, review window over (expire); c5…01
-- uploaded in suspended tenant C (waits until the organization is served again).
select tests.import_file('a5000000-0000-4000-8000-000000000015', 'a0000000-0000-4000-8000-000000000001',
                         '00000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-000000000015');
select tests.import_file('a5000000-0000-4000-8000-000000000016', 'a0000000-0000-4000-8000-000000000001',
                         '00000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-000000000016', 'wait.csv',
                         'pending_upload');
select tests.import_file('a5000000-0000-4000-8000-000000000017', 'a0000000-0000-4000-8000-000000000001',
                         '00000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-000000000017');
select tests.import_file('c5000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
                         '00000000-0000-4000-8000-0000000000c1', 'f0c00000-0000-4000-8000-000000000001');
insert into platform.user_imports (id, tenant_id, created_by, file_id, file_name, file_size, status, sheets,
                                   review_expires_at) values
  ('a5000000-0000-4000-8000-000000000015', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
   'f0a00000-0000-4000-8000-000000000015', 'read.csv', 100, 'uploaded', '[]', now() + interval '1 day'),
  ('a5000000-0000-4000-8000-000000000016', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
   'f0a00000-0000-4000-8000-000000000016', 'wait.csv', 100, 'uploaded', '[]', now() + interval '1 day'),
  ('a5000000-0000-4000-8000-000000000017', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
   'f0a00000-0000-4000-8000-000000000017', 'late.csv', 100, 'mapping', '[{"name": "", "rows": 1, "columns": 1}]',
   now() - interval '1 minute'),
  ('c5000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1',
   'f0c00000-0000-4000-8000-000000000001', 'c.csv', 100, 'uploaded', '[]', now() + interval '1 day');

insert into platform.persons (id, tenant_id, display_name_ar, email) values
  ('a1000000-0000-4000-8000-000000000c07', 'a0000000-0000-4000-8000-000000000001', 'دعوة محجوزة', 'held@imp.test');
insert into platform.invitations (id, tenant_id, person_id, email, locale, primary_role, invited_by, import_id, mail_held) values
  ('a4000000-0000-4000-8000-000000000c07', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c07',
   'held@imp.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000a1', 'a5000000-0000-4000-8000-000000000011', true);

insert into platform.session_context (session_id, user_id, active_tenant_id)
  values ('10000000-0000-4000-8000-0000000000f7', '00000000-0000-4000-8000-0000000000f7', 'a0000000-0000-4000-8000-000000000001')
  on conflict do nothing;

\echo '85_user_imports_fixtures: ok'
