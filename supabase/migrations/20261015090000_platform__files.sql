-- File storage and malware scanning (ADR 0006, ADR 0002 §8; T-M2-18; NFR-SEC-08; docs/engineering/files.md).
-- Class: T (tenant) + one global reference table. PII: sanitized original file names and the uploader's
-- ids in this database; file contents live in Supabase Storage only (never here, never in logs).
--
--   platform.file_purposes         GLOBAL reference: what a purpose may store — bucket, size limit, types
--                                  detected by content, retention class, download audit and link lifetime,
--                                  and who writes it (`user` uploads or `worker`-generated files). Modules
--                                  add their purposes in their own migrations.
--   platform.files                 one row per stored object: tenant, bucket, object key
--                                  <tenant>/<module>/<entity type>/<entity id>/<file id> (the original name
--                                  is never part of it), purpose, owner, sanitized name, declared and detected
--                                  type, size, sha256, status, scan engine/signatures/finding, retention class,
--                                  legal hold, uploader, timestamps.
--   platform.file_download_grants  short-lived (≤ 5 min, ADR 0006 §4) per-user read grants for one file of
--                                  one owner entity: the Storage SELECT policy requires one, so a user token
--                                  alone reads nothing (TM-0001 F-13, T-34).
--   file_guard                     NOLOGIN owner of every function below (pattern of account_mail_guard):
--                                  no BYPASSRLS; explicit grants and `to file_guard` policies.
--   private.storage_object_facts   view of storage.objects (bucket, name, reported size and content type,
--                                  creation time) for file_guard only, owned by the migration role (pattern
--                                  of private.auth_session_validity).
--   private.storage_request_tenant()  (owner tenant_guard) the tenant of USER claims set by Supabase Storage
--                                  under its own login role, validated exactly like private.current_tenant_id()
--                                  validates them for app_server (ADR 0002 §6a: live session, active
--                                  membership, the session's active tenant). Used by the storage policies
--                                  (migration 20261015090100) only; tenant tables stay unreadable under
--                                  Storage's login role.
--
-- Status (trigger files_transition): pending_upload → uploaded → scanning → clean | infected | rejected |
-- error; pending_upload → rejected (confirmation: empty, too large, or stored with another content type);
-- pending_upload → clean only for worker-generated purposes; → deleted from pending_upload, uploaded,
-- scanning (only while no worker holds its scan lease: delete_file), clean, rejected, error. Nothing is
-- readable or processed before `clean` (storage policy, openScannedFile, download grants).
--
-- Callers (each function checks the LOGIN role and the claims itself; errors: 42501 wrong caller,
-- JF0xx domain refusals mapped by packages/platform-db/src/files.ts):
--   web app (app_server, user claims):   create_file_upload, confirm_file_upload, grant_file_download,
--                                        delete_file, mark_file_used
--   Storage (supabase_storage_admin):    can_upload_object, can_read_object (storage.objects policies)
--   worker (app_worker, system claims):  claim_file_scan, finish_file_scan, retry_file_scan,
--                                        claim_file_housekeeping, lock_file_housekeeping,
--                                        finish_file_housekeeping, claim_orphan_objects,
--                                        create_generated_file, finish_generated_file, delete_file,
--                                        mark_file_used
-- Domain SQLSTATEs: JF001 type not allowed · JF002 too large · JF003 unknown purpose · JF004 file not
-- found · JF005 object not uploaded · JF006 upload expired · JF007 too many pending uploads · JF008 file
-- not clean · JF009 file not deletable now.

-- ---------------------------------------------------------------------------------------------------
-- Role file_guard (attribute policy as in 20260930120000)
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'file_guard') then
    create role file_guard nologin noinherit nobypassrls;
  end if;
end
$$;

do $$
declare
  r record;
begin
  select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolreplication, rolcreatedb, rolcreaterole
    into r from pg_roles where rolname = 'file_guard';
  if r.rolsuper or r.rolbypassrls or r.rolreplication then
    raise exception 'role file_guard must be NOSUPERUSER NOBYPASSRLS NOREPLICATION; fix it as a superuser first';
  end if;
  if r.rolinherit or r.rolcreatedb or r.rolcreaterole or r.rolcanlogin then
    alter role file_guard nologin noinherit nocreatedb nocreaterole;
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
             where g.rolname = 'file_guard' and (m.inherit_option or m.set_option)
               and not u.rolsuper and u.rolname <> current_user) then
    raise exception 'role file_guard must have no members besides the migration role';
  end if;
end
$$;

grant file_guard to current_user;
grant usage on schema platform, private to file_guard;

-- ---------------------------------------------------------------------------------------------------
-- platform.file_purposes (global reference table; read-only for everyone but migrations)
-- ---------------------------------------------------------------------------------------------------
create table platform.file_purposes (
  purpose text primary key,
  bucket text not null,
  max_bytes bigint not null,
  -- Types accepted after detection by CONTENT (magic bytes, CSV text sniffing), never by name or header.
  allowed_types text[] not null,
  retention_class text not null,
  -- Who writes the files: `user` (direct upload with a signed URL, scanned) or `worker` (generated by a job
  -- from scanned inputs: stored as clean).
  upload_by text not null,
  -- Downloads of these files are audited (personal data: evidence, exports, import reports).
  audit_downloads boolean not null,
  -- Lifetime of a download grant and of its signed URL (ADR 0006 §5: 60 s documents, 300 s media; at
  -- most 5 minutes, ADR 0006 §4).
  download_ttl_seconds integer not null,
  constraint file_purposes_name_check check (purpose ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' and char_length(purpose) <= 100),
  constraint file_purposes_bucket_check check (bucket in ('materials', 'images', 'evidence', 'imports', 'generated')),
  constraint file_purposes_size_check check (max_bytes between 1 and 209715200),
  constraint file_purposes_types_check check (cardinality(allowed_types) between 1 and 20
    and array_position(allowed_types, null) is null),
  constraint file_purposes_retention_check check (retention_class in ('import', 'owner_lifetime', 'record', 'export')),
  constraint file_purposes_upload_by_check check (upload_by in ('user', 'worker')
    and (upload_by = 'worker') = (bucket = 'generated')),
  constraint file_purposes_ttl_check check (download_ttl_seconds between 10 and 300)
);
comment on table platform.file_purposes is
  'File purposes (ADR 0006 §1, T-M2-18): bucket, size, detected types, retention, download audit/TTL. Global reference data; changed by migrations only.';

insert into platform.file_purposes (purpose, bucket, max_bytes, allowed_types, retention_class, upload_by,
                                    audit_downloads, download_ttl_seconds) values
  -- Bulk user import (T-M2-12, FR-IAM-04): CSV (UTF-8) or XLSX, 20 MB; kept 7 days after use, 24 hours if
  -- never used (PO, 9 Oct 2026).
  ('platform.user_import', 'imports', 20971520,
   array['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], 'import', 'user', true, 60),
  -- The import's error report (T-M2-12): written by the import job; downloads audited.
  ('platform.user_import_report', 'generated', 52428800, array['text/csv'], 'import', 'worker', true, 60),
  -- Profile photo (T-M2-15b, FR-IAM-16): PNG/JPEG/WebP (never SVG or GIF), life of the owner.
  ('platform.profile_photo', 'images', 10485760, array['image/png', 'image/jpeg', 'image/webp'],
   'owner_lifetime', 'user', false, 300);

alter table platform.file_purposes enable row level security;
alter table platform.file_purposes force row level security;
create policy file_purposes_read on platform.file_purposes for select to authenticated using (true);
create policy file_purposes_guard_read on platform.file_purposes for select to file_guard using (true);
revoke all on platform.file_purposes from public, anon;
grant select on platform.file_purposes to authenticated, file_guard;

-- ---------------------------------------------------------------------------------------------------
-- platform.files
-- ---------------------------------------------------------------------------------------------------
create table platform.files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  bucket text not null,
  object_key text not null,
  purpose text not null references platform.file_purposes (purpose),
  -- The owning entity (no cross-schema FK; the owning module checks access to it, ADR 0006 §5).
  owner_module text not null,
  owner_entity_type text not null,
  owner_entity_id uuid not null,
  -- Sanitized, NFC-normalized original name (packages/platform-files names.ts); returned only through
  -- Content-Disposition (RFC 6266), never part of the key.
  original_name text not null,
  declared_mime text not null,
  declared_size bigint not null,
  -- Set by the scan (bytes actually read, type detected by content, hash of the stored object).
  detected_mime text,
  size_bytes bigint,
  sha256 text,
  status text not null default 'pending_upload',
  status_reason text,
  scan_engine text,
  scan_signatures text,
  scan_finding text,
  scanned_at timestamptz,
  -- Scan leases so far; failures OF THIS FILE (the scanner answered, the file could not be scanned): error
  -- after 5; suspected scanner CRASHES on this file (clamd lost its stream and did not answer a PING right
  -- after): error after 3 (retry_file_scan). Unavailability of the scanner or Storage before the file's
  -- stream started is not counted against the file.
  scan_attempts smallint not null default 0,
  scan_failures smallint not null default 0,
  scan_crashes smallint not null default 0,
  scan_not_before timestamptz not null default now(),
  scan_leased_until timestamptz,
  -- When the last scan lease was taken: organizations take turns (claim_file_scan).
  scan_claimed_at timestamptz,
  retention_class text not null,
  legal_hold boolean not null default false,
  used_at timestamptz,
  created_by_user uuid,
  created_by_person uuid,
  created_at timestamptz not null default now(),
  upload_expires_at timestamptz not null,
  uploaded_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  quarantined_at timestamptz,
  object_removed_at timestamptz,
  -- Object and name removed (retention) while a business row still references the file.
  purged_at timestamptz,
  housekeeping_leased_until timestamptz,
  unique (tenant_id, id),
  constraint files_object_uq unique (bucket, object_key),
  constraint files_bucket_check check (bucket in ('materials', 'images', 'evidence', 'imports', 'generated', 'quarantine')),
  constraint files_key_check check (object_key = tenant_id::text || '/' || owner_module || '/' || owner_entity_type
                                                 || '/' || owner_entity_id::text || '/' || id::text),
  constraint files_owner_check check (owner_module ~ '^[a-z][a-z0-9_]{0,30}$' and owner_entity_type ~ '^[a-z][a-z0-9_]{0,60}$'),
  -- No control characters, path separators or bidirectional overrides (filename spoofing).
  constraint files_name_check check (
    char_length(original_name) between 1 and 255
    and original_name !~ '[\x01-\x1f\x7f/\\]'
    and original_name !~ '[\u0080-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]'),
  constraint files_declared_mime_check check (declared_mime ~ '^[a-z0-9][a-z0-9.+-]{0,62}/[a-z0-9][a-z0-9.+-]{0,62}$'),
  constraint files_detected_mime_check check (detected_mime is null or detected_mime ~ '^[a-z0-9][a-z0-9.+-]{0,62}/[a-z0-9][a-z0-9.+-]{0,62}$'),
  constraint files_size_check check (declared_size between 1 and 209715200 and (size_bytes is null or size_bytes between 0 and 209715200)),
  constraint files_sha256_check check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint files_status_check check (status in ('pending_upload', 'uploaded', 'scanning', 'clean', 'infected', 'rejected', 'error', 'deleted')),
  constraint files_reason_check check (status_reason is null or status_reason ~ '^[a-z][a-z_]{1,40}$'),
  constraint files_scan_text_check check (
    (scan_engine is null or (char_length(scan_engine) <= 100 and scan_engine !~ '[\x01-\x1f\x7f]'))
    and (scan_signatures is null or (char_length(scan_signatures) <= 200 and scan_signatures !~ '[\x01-\x1f\x7f]'))
    and (scan_finding is null or (char_length(scan_finding) <= 200 and scan_finding !~ '[\x01-\x1f\x7f]'))),
  constraint files_attempts_check check (scan_attempts between 0 and 1000 and scan_failures between 0 and 1000
    and scan_crashes between 0 and 1000),
  constraint files_retention_check check (retention_class in ('import', 'owner_lifetime', 'record', 'export')),
  -- A clean file has everything the scan established.
  constraint files_clean_check check (status <> 'clean'
    or (detected_mime is not null and size_bytes is not null and sha256 is not null and scanned_at is not null)),
  constraint files_quarantine_check check ((bucket = 'quarantine') = (quarantined_at is not null)
    and (bucket <> 'quarantine' or status = 'infected'))
);
comment on table platform.files is
  'Stored files (ADR 0006 §2, T-M2-18). Written only through file_guard''s functions; readable by the uploader and jobs. Contents live in Supabase Storage. Owner: platform.';

create index files_tenant_idx on platform.files (tenant_id);
create index files_owner_idx on platform.files (tenant_id, owner_module, owner_entity_type, owner_entity_id);
create index files_scan_queue_idx on platform.files (uploaded_at, id) where status in ('uploaded', 'scanning');
-- Each organization's last scan turn (claim_file_scan: organizations take turns).
create index files_scan_turn_idx on platform.files (tenant_id, scan_claimed_at) where scan_claimed_at is not null;
create index files_pending_user_idx on platform.files (created_by_user, created_at) where status = 'pending_upload';
-- Housekeeping candidates: everything not purged yet (small: files leave this index when purged).
create index files_housekeeping_idx on platform.files (created_at) where purged_at is null;

alter table platform.files enable row level security;
alter table platform.files force row level security;

create policy tenant_isolation on platform.files
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- The uploader sees their own files; jobs (system claims) see their tenant's. Other people reach a file only
-- through the owning module (which checks access to the owner entity) and a download grant.
create policy files_read on platform.files for select to authenticated
  using (created_by_user = (select private.request_user_id())
         or (select private.request_claims() ->> 'role') = 'system');
create policy files_guard on platform.files for all to file_guard using (true) with check (true);

revoke all on platform.files from public, anon;
grant select on platform.files to authenticated;
grant select, insert, update, delete on platform.files to file_guard;

-- ---------------------------------------------------------------------------------------------------
-- platform.file_download_grants
-- ---------------------------------------------------------------------------------------------------
create table platform.file_download_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  file_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (tenant_id, id),
  foreign key (tenant_id, file_id) references platform.files (tenant_id, id) on delete cascade,
  constraint file_download_grants_ttl_check check (expires_at > created_at and expires_at <= created_at + interval '5 minutes')
);
comment on table platform.file_download_grants is
  'Short-lived read grants (ADR 0006 §4–§5, T-M2-18): created by the action that authorized a download; required by the storage SELECT policy. Owner: platform.';
create index file_download_grants_lookup_idx on platform.file_download_grants (file_id, user_id, expires_at);
create index file_download_grants_expiry_idx on platform.file_download_grants (expires_at);

alter table platform.file_download_grants enable row level security;
alter table platform.file_download_grants force row level security;
create policy tenant_isolation on platform.file_download_grants
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy file_download_grants_read on platform.file_download_grants for select to authenticated
  using (user_id = (select private.request_user_id()));
create policy file_download_grants_guard on platform.file_download_grants for all to file_guard
  using (true) with check (true);
revoke all on platform.file_download_grants from public, anon;
grant select on platform.file_download_grants to authenticated;
grant select, insert, delete on platform.file_download_grants to file_guard;

-- What file_guard reads elsewhere: whether an organization is served (active or trial), and whether the
-- user a generated file is made for is an active member.
create policy tenants_file_guard_read on platform.tenants for select to file_guard using (true);
grant select (id, status) on platform.tenants to file_guard;
create policy tenant_memberships_file_guard_read on platform.tenant_memberships for select to file_guard using (true);
grant select (tenant_id, user_id, status) on platform.tenant_memberships to file_guard;

grant execute on function private.try_uuid(text) to file_guard;
grant execute on function private.request_claims() to file_guard;
grant execute on function private.request_user_id() to file_guard;
grant execute on function private.request_person_id() to file_guard;
grant execute on function private.current_tenant_id() to file_guard;

-- ---------------------------------------------------------------------------------------------------
-- Storage objects for file_guard (pattern of private.auth_session_validity, ADR 0002 §6a rev. 2): the
-- migration role reads storage.objects (Supabase grants it ALL WITH GRANT OPTION and BYPASSRLS); a view
-- reads with its owner's rights, so file_guard sees whether an object exists, its reported size, the
-- content type it was stored with (the uploader's Content-Type, which Storage serves it with) and when
-- it was created — nothing of the content, owner or user metadata.
-- ---------------------------------------------------------------------------------------------------
create or replace view private.storage_object_facts
with (security_barrier = true)  -- defensive only: the view has no WHERE clause
as select o.bucket_id, o.name, o.metadata ->> 'size' as size_text, o.metadata ->> 'mimetype' as content_type,
          o.created_at
   from storage.objects o;

comment on view private.storage_object_facts is
  'SECURITY-RELEVANT (T-M2-18): storage.objects (bucket_id, name, reported size, stored content type, created_at) for file_guard only. Owned by the migration role.';

revoke all on private.storage_object_facts from public;
grant select on private.storage_object_facts to file_guard;

do $$
declare
  v_owner name := (select pg_get_userbyid(relowner) from pg_class where oid = 'private.storage_object_facts'::regclass);
  v_column text;
begin
  foreach v_column in array array['bucket_id', 'name', 'metadata', 'created_at'] loop
    if not (has_schema_privilege(v_owner, 'storage', 'usage')
            and has_column_privilege(v_owner, 'storage.objects', v_column, 'select')) then
      raise exception 'role % (owner of private.storage_object_facts) cannot read storage.objects (%)', v_owner, v_column;
    end if;
  end loop;
  -- storage.objects has RLS enabled: without bypassing it the view would silently see no object.
  if not exists (select 1 from pg_roles where rolname = v_owner and (rolsuper or rolbypassrls)) then
    raise exception 'role % (owner of private.storage_object_facts) must bypass row-level security on storage.objects', v_owner;
  end if;
  if not has_table_privilege('file_guard', 'private.storage_object_facts', 'select') then
    raise exception 'file_guard cannot read private.storage_object_facts';
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------------
-- Write guard: allowed status transitions, immutable identity (defence in depth behind the functions).
-- SECURITY INVOKER; runs as the writer (file_guard inside its functions, or an operator).
-- ---------------------------------------------------------------------------------------------------
create or replace function private.files_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending_upload' or new.scan_attempts <> 0 or new.scan_failures <> 0 or new.scan_crashes <> 0
       or new.scan_claimed_at is not null or new.used_at is not null or new.deleted_at is not null
       or new.uploaded_at is not null or new.quarantined_at is not null or new.object_removed_at is not null
       or new.purged_at is not null or new.detected_mime is not null or new.sha256 is not null or new.size_bytes is not null then
      raise exception 'a file starts as pending_upload' using errcode = 'insufficient_privilege';
    end if;
    new.created_at := now();
    new.updated_at := new.created_at;
    return new;
  end if;
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.object_key <> old.object_key or new.purpose <> old.purpose
     or new.owner_module <> old.owner_module or new.owner_entity_type <> old.owner_entity_type
     or new.owner_entity_id <> old.owner_entity_id or new.declared_mime <> old.declared_mime
     or new.declared_size <> old.declared_size or new.retention_class <> old.retention_class
     or new.created_by_user is distinct from old.created_by_user or new.created_by_person is distinct from old.created_by_person
     or new.created_at <> old.created_at or new.upload_expires_at <> old.upload_expires_at then
    raise exception 'the identity of a file cannot change' using errcode = 'insufficient_privilege';
  end if;
  -- The object moves only into quarantine, once, for an infected file.
  if new.bucket <> old.bucket and not (old.status = 'infected' and new.status = 'infected' and new.bucket = 'quarantine') then
    raise exception 'a file changes bucket only into quarantine' using errcode = 'insufficient_privilege';
  end if;
  if new.status <> old.status then
    v_ok := case old.status
      when 'pending_upload' then new.status in ('uploaded', 'rejected', 'deleted')
        or (new.status = 'clean' and exists (select 1 from platform.file_purposes p
                                             where p.purpose = new.purpose and p.upload_by = 'worker'))
      when 'uploaded' then new.status in ('scanning', 'deleted')
      -- → deleted: a file waiting for the scanner (its owner gives up; delete_file checks no worker holds
      -- the scan lease). Never readable or usable before a verdict, so nothing is lost but the wait.
      when 'scanning' then new.status in ('clean', 'infected', 'rejected', 'error', 'deleted')
      when 'clean' then new.status = 'deleted'
      when 'rejected' then new.status = 'deleted'
      when 'error' then new.status = 'deleted'
      else false
    end;
    if not v_ok then
      raise exception 'file status % cannot become %', old.status, new.status using errcode = 'insufficient_privilege';
    end if;
  end if;
  -- What the scan established does not change afterwards.
  if old.status in ('clean', 'infected') and (new.sha256 is distinct from old.sha256
       or new.detected_mime is distinct from old.detected_mime or new.size_bytes is distinct from old.size_bytes) then
    raise exception 'the scan result of a file cannot change' using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end
$$;
comment on function private.files_transition() is
  'SECURITY-RELEVANT (T-M2-18). platform.files write guard: new files start pending_upload; allowed status transitions only; identity immutable; bucket changes only into quarantine.';
revoke all on function private.files_transition() from public;

create trigger files_transition before insert or update on platform.files
  for each row execute function private.files_transition();

-- A confirmed upload wakes the workers (channel jadarat_events, ADR 0004 §4): daemon workers run the scan
-- task within seconds; the minutely schedule covers any gap.
create trigger files_uploaded_notify after update of status on platform.files
  for each row when (new.status = 'uploaded' and old.status is distinct from 'uploaded')
  execute function private.notify_event_dispatcher();

-- ---------------------------------------------------------------------------------------------------
-- Storage's user claims (owner tenant_guard; ADR 0002 §6a)
-- ---------------------------------------------------------------------------------------------------
-- Supabase Storage connects with its own LOGIN role (supabase_storage_admin: self-hosted compose and
-- hosted Supabase; checked on staging after deployment, docs/engineering/files.md §7) and sets the caller's
-- JWT payload as request.jwt.claims. Same validation as private.current_tenant_id() for app_server.
create or replace function private.storage_request_tenant()
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_tenant uuid;
  v_user uuid;
  v_session uuid;
begin
  if session_user <> 'supabase_storage_admin' or v_claims is null
     or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    return null;
  end if;
  v_tenant := private.try_uuid(v_claims ->> 'tenant_id');
  v_user := private.try_uuid(v_claims ->> 'sub');
  v_session := private.try_uuid(v_claims ->> 'session_id');
  if v_tenant is not null
     and private.user_session_is_valid(v_user, v_session)
     and private.has_active_membership(v_user, v_tenant)
     and exists (select 1 from platform.session_context c
                 where c.session_id = v_session and c.user_id = v_user and c.active_tenant_id = v_tenant) then
    return v_tenant;
  end if;
  return null;
end
$$;
comment on function private.storage_request_tenant() is
  'SECURITY-RELEVANT (ADR 0002 §6a, T-M2-18). Tenant of the USER claims Supabase Storage sets under its login role supabase_storage_admin, validated like current_tenant_id(); else NULL. For the storage.objects policies.';

-- ---------------------------------------------------------------------------------------------------
-- Request path (web app: app_server, user claims)
-- ---------------------------------------------------------------------------------------------------

-- The signed-in user's tenant, or 42501 (user claims under app_server only: current_tenant_id() checks
-- the login role).
create or replace function private.file_user_tenant()
returns uuid
language plpgsql stable
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
begin
  if v_tenant is null or coalesce(private.request_claims() ->> 'role', '') <> 'authenticated'
     or private.request_user_id() is null then
    raise exception 'reserved to a signed-in user' using errcode = 'insufficient_privilege';
  end if;
  return v_tenant;
end
$$;
revoke all on function private.file_user_tenant() from public;

-- An upload intent: the pending row whose key the signed upload URL is created for (by the web app, with
-- the user's own session: the storage INSERT policy admits exactly this key, for this user, for 15
-- minutes). The owning module has checked the user may attach a file to the owner entity.
create or replace function private.create_file_upload(
  p_purpose text, p_owner_module text, p_owner_entity_type text, p_owner_entity_id uuid,
  p_original_name text, p_declared_mime text, p_declared_size bigint)
returns table (id uuid, bucket text, object_key text, upload_expires_at timestamptz, max_bytes bigint)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.file_user_tenant();
  v_user uuid := private.request_user_id();
  v_purpose record;
  v_id uuid := gen_random_uuid();
begin
  select p.* into v_purpose from platform.file_purposes p where p.purpose = p_purpose and p.upload_by = 'user';
  if not found then
    raise exception 'unknown purpose' using errcode = 'JF003';
  end if;
  if p_declared_mime is null or not (p_declared_mime = any (v_purpose.allowed_types)) then
    raise exception 'type not allowed for this purpose' using errcode = 'JF001';
  end if;
  if p_declared_size is null or p_declared_size < 1 or p_declared_size > v_purpose.max_bytes then
    raise exception 'file too large' using errcode = 'JF002';
  end if;
  -- At most 50 unconfirmed uploads per user in 24 hours (abandoned intents are purged after 24 hours).
  if (select count(*) from (select 1 from platform.files f
                            where f.created_by_user = v_user and f.status = 'pending_upload'
                              and f.created_at > now() - interval '24 hours' limit 50) w) >= 50 then
    raise exception 'too many pending uploads' using errcode = 'JF007';
  end if;
  insert into platform.files as f (id, tenant_id, bucket, object_key, purpose, owner_module, owner_entity_type,
                                   owner_entity_id, original_name, declared_mime, declared_size, retention_class,
                                   created_by_user, created_by_person, upload_expires_at)
  values (v_id, v_tenant, v_purpose.bucket,
          v_tenant::text || '/' || p_owner_module || '/' || p_owner_entity_type || '/' || p_owner_entity_id::text || '/' || v_id::text,
          p_purpose, p_owner_module, p_owner_entity_type, p_owner_entity_id, p_original_name, p_declared_mime,
          p_declared_size, v_purpose.retention_class, v_user, private.request_person_id(), now() + interval '15 minutes');
  return query select f.id, f.bucket, f.object_key, f.upload_expires_at, v_purpose.max_bytes
               from platform.files f where f.id = v_id;
end
$$;
comment on function private.create_file_upload(text, text, text, uuid, text, text, bigint) is
  'SECURITY-RELEVANT (T-M2-18). Web app: a pending upload (key, 15-minute window) for the signed-in user, checked against the purpose. User claims under app_server only.';

-- After the browser's upload: the object must exist; an empty or oversized object (Storage's reported size),
-- or one stored with another content type than the declared one (Storage serves it with that type), is
-- rejected at once; otherwise the file waits for the scan (`uploaded`). Uploaded purposes only: a
-- worker-generated file is never confirmed by a user. Idempotent: a repeated call returns the current
-- status.
create or replace function private.confirm_file_upload(p_file_id uuid)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.file_user_tenant();
  v_file record;
  v_size_text text;
  v_type_text text;
  v_size bigint;
  v_max bigint;
begin
  select f.*, p.max_bytes into v_file
  from platform.files f join platform.file_purposes p on p.purpose = f.purpose and p.upload_by = 'user'
  where f.id = p_file_id and f.tenant_id = v_tenant and f.created_by_user = private.request_user_id()
    and f.purged_at is null
  for update of f;
  if not found then
    raise exception 'file not found' using errcode = 'JF004';
  end if;
  if v_file.status <> 'pending_upload' then
    return v_file.status;
  end if;
  if v_file.created_at < now() - interval '24 hours' then
    raise exception 'upload expired' using errcode = 'JF006';
  end if;
  select o.size_text, o.content_type into v_size_text, v_type_text from private.storage_object_facts o
  where o.bucket_id = v_file.bucket and o.name = v_file.object_key;
  if not found then
    raise exception 'object not uploaded' using errcode = 'JF005';
  end if;
  v_max := v_file.max_bytes;
  v_size := case when v_size_text ~ '^[0-9]{1,15}$' then v_size_text::bigint end;
  if v_size = 0 then
    update platform.files f set status = 'rejected', status_reason = 'empty', uploaded_at = now(), size_bytes = 0
    where f.id = v_file.id;
    return 'rejected';
  end if;
  if v_size > v_max then
    update platform.files f set status = 'rejected', status_reason = 'too_large', uploaded_at = now()
    where f.id = v_file.id;
    return 'rejected';
  end if;
  -- The Content-Type of the upload (parameters such as `; charset=utf-8` ignored) must be the declared type
  -- the upload intent told the browser to send.
  if v_type_text is null or lower(btrim(split_part(v_type_text, ';', 1))) <> v_file.declared_mime then
    update platform.files f set status = 'rejected', status_reason = 'type_mismatch', uploaded_at = now()
    where f.id = v_file.id;
    return 'rejected';
  end if;
  -- Storage's reported size (may be unknown); the scan counts the bytes it reads and records those.
  update platform.files f set status = 'uploaded', uploaded_at = now(), scan_not_before = now(), size_bytes = v_size
  where f.id = v_file.id;
  return 'uploaded';
end
$$;
comment on function private.confirm_file_upload(uuid) is
  'SECURITY-RELEVANT (T-M2-18). Web app: the uploader confirms an upload (uploaded purposes only); the object must exist in Storage; empty, oversized or stored with another content type → rejected, else uploaded (queued for the scan). User claims under app_server only.';

-- A download grant for the signed-in user, after the owning module authorized THIS user to read files of
-- THIS owner entity for THIS purpose: the file must belong to exactly that owner and purpose (a module that
-- checked access to entity X can never hand out a file of entity Y), and be clean. Returns what the web app
-- needs to create the signed URL (same lifetime) and whether to audit.
create or replace function private.grant_file_download(
  p_file_id uuid, p_purpose text, p_owner_module text, p_owner_entity_type text, p_owner_entity_id uuid)
returns table (bucket text, object_key text, original_name text, detected_mime text, ttl_seconds integer,
               audit_downloads boolean)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.file_user_tenant();
  v_user uuid := private.request_user_id();
  v_file record;
begin
  select f.id, f.bucket, f.object_key, f.original_name, f.detected_mime, f.status, p.download_ttl_seconds,
         p.audit_downloads
    into v_file
  from platform.files f join platform.file_purposes p on p.purpose = f.purpose
  where f.id = p_file_id and f.tenant_id = v_tenant and f.deleted_at is null and f.purged_at is null
    -- The owner the module authorized (all four required: a NULL never matches).
    and f.purpose = p_purpose and f.owner_module = p_owner_module and f.owner_entity_type = p_owner_entity_type
    and f.owner_entity_id = p_owner_entity_id;
  if not found then
    raise exception 'file not found' using errcode = 'JF004';
  end if;
  if v_file.status <> 'clean' then
    raise exception 'file not clean' using errcode = 'JF008';
  end if;
  delete from platform.file_download_grants g where g.user_id = v_user and g.expires_at < now();
  insert into platform.file_download_grants (tenant_id, file_id, user_id, expires_at)
  values (v_tenant, v_file.id, v_user, now() + make_interval(secs => v_file.download_ttl_seconds));
  return query select v_file.bucket, v_file.object_key, v_file.original_name, v_file.detected_mime,
                      v_file.download_ttl_seconds, v_file.audit_downloads;
end
$$;
comment on function private.grant_file_download(uuid, text, text, text, uuid) is
  'SECURITY-RELEVANT (T-M2-18). Web app: a short-lived download grant for the signed-in user on a clean file of their tenant that belongs to the owner entity and purpose the owning module authorized. User claims under app_server only.';

-- The caller acting on a file: the uploader (user claims under app_server) or a job of the file's tenant
-- (system claims under app_worker; current_tenant_id() checks the login role).
create or replace function private.file_for_actor(p_file_id uuid)
returns uuid
language plpgsql stable
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_role text := coalesce(private.request_claims() ->> 'role', '');
begin
  if v_tenant is null or v_role not in ('authenticated', 'system') then
    raise exception 'reserved to the uploader or a job' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from platform.files f
                 where f.id = p_file_id and f.tenant_id = v_tenant and f.purged_at is null
                   and (v_role = 'system' or f.created_by_user = private.request_user_id())) then
    raise exception 'file not found' using errcode = 'JF004';
  end if;
  return p_file_id;
end
$$;
revoke all on function private.file_for_actor(uuid) from public;

-- Deleting a file (soft: the housekeeping job removes the object per retention class, unless on legal
-- hold). A file waiting for the scanner (or failed: `error`) can be deleted — it was never readable;
-- not while a worker holds its scan lease (the verdict, e.g. a malware finding, is recorded first), and
-- never an infected file (kept in quarantine for 30 days).
create or replace function private.delete_file(p_file_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_status text;
  v_leased boolean;
begin
  perform private.file_for_actor(p_file_id);
  select f.status, coalesce(f.scan_leased_until > now(), false) into v_status, v_leased
  from platform.files f where f.id = p_file_id for update;
  if v_status = 'deleted' then
    return false;
  end if;
  if v_status = 'infected' or (v_status = 'scanning' and v_leased) then
    raise exception 'file cannot be deleted now' using errcode = 'JF009';
  end if;
  update platform.files f set status = 'deleted', deleted_at = now(), scan_leased_until = null
  where f.id = p_file_id;
  delete from platform.file_download_grants g where g.file_id = p_file_id;
  return true;
end
$$;
comment on function private.delete_file(uuid) is
  'SECURITY-RELEVANT (T-M2-18). The uploader or a job of the tenant marks a file deleted (housekeeping removes it per retention class); not an infected file, nor one a worker is scanning.';

-- The owning module used the file (e.g. an import was confirmed): import files are kept 7 days from then.
create or replace function private.mark_file_used(p_file_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.file_for_actor(p_file_id);
  update platform.files f set used_at = now()
  where f.id = p_file_id and f.status = 'clean' and f.used_at is null;
  if found then
    return true;
  end if;
  if not exists (select 1 from platform.files f where f.id = p_file_id and f.status = 'clean') then
    raise exception 'file not clean' using errcode = 'JF008';
  end if;
  return false;
end
$$;
comment on function private.mark_file_used(uuid) is
  'SECURITY-RELEVANT (T-M2-18). The uploader or a job records the first use of a clean file (start of the retention clock for imports).';

-- ---------------------------------------------------------------------------------------------------
-- Storage policies' checks (Supabase Storage under its login role, user claims)
-- ---------------------------------------------------------------------------------------------------
-- INSERT: exactly the pending key of this user, in their tenant, inside the 15-minute window, of a purpose
-- users upload (never a worker-generated file reserved for them).
create or replace function private.can_upload_object(p_bucket text, p_name text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.storage_request_tenant();
begin
  if v_tenant is null or p_bucket is null or p_name is null then
    return false;
  end if;
  return exists (
    select 1 from platform.files f join platform.file_purposes p on p.purpose = f.purpose and p.upload_by = 'user'
    where f.bucket = p_bucket and f.object_key = p_name and f.tenant_id = v_tenant and f.status = 'pending_upload'
      and f.created_by_user = private.request_user_id() and f.upload_expires_at > now());
end
$$;
comment on function private.can_upload_object(text, text) is
  'SECURITY-RELEVANT (ADR 0006 §4, T-M2-18). storage.objects INSERT policy: the pending upload of this user and tenant, unexpired, of an uploaded (not worker-generated) purpose.';

-- SELECT: a clean, undeleted file of the caller's tenant with an unexpired grant for the caller.
create or replace function private.can_read_object(p_bucket text, p_name text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.storage_request_tenant();
begin
  if v_tenant is null or p_bucket is null or p_name is null then
    return false;
  end if;
  return exists (
    select 1 from platform.files f
    join platform.file_download_grants g on g.tenant_id = f.tenant_id and g.file_id = f.id
    where f.bucket = p_bucket and f.object_key = p_name and f.tenant_id = v_tenant and f.status = 'clean'
      and f.deleted_at is null and g.user_id = private.request_user_id() and g.expires_at > now());
end
$$;
comment on function private.can_read_object(text, text) is
  'SECURITY-RELEVANT (ADR 0006 §4, T-M2-18). storage.objects SELECT policy: clean file of the caller''s tenant with an unexpired download grant for the caller.';

-- ---------------------------------------------------------------------------------------------------
-- Worker (app_worker, system claims)
-- ---------------------------------------------------------------------------------------------------
-- A job of the worker: system claims with a job id under the app_worker login, with or without a tenant.
create or replace function private.file_worker_check()
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
revoke all on function private.file_worker_check() from public;

-- Leases the next file to scan: organizations take turns (the one whose last scan turn is longest ago, or
-- that never had one, first), then that organization's oldest due file — one organization's many uploads,
-- or a file that keeps failing, never holds up the others. Organizations that are not served (suspended,
-- closed) wait; a file housekeeping is working on waits. Status scanning, 15-minute lease, one more
-- attempt. The purpose's limits come with it (one source of truth).
create or replace function private.claim_file_scan()
returns table (id uuid, tenant_id uuid, bucket text, object_key text, purpose text, declared_mime text,
               size_bytes bigint, max_bytes bigint, allowed_types text[], attempts integer)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_tenant uuid;
begin
  perform private.file_worker_check();
  for v_tenant in
    select d.tenant_id
    from (select f.tenant_id, min(f.uploaded_at) as oldest
          from platform.files f
          where f.status in ('uploaded', 'scanning') and f.scan_not_before <= now()
            and (f.scan_leased_until is null or f.scan_leased_until <= now()) and f.purged_at is null
            and (f.housekeeping_leased_until is null or f.housekeeping_leased_until <= now())
            and exists (select 1 from platform.tenants t where t.id = f.tenant_id and t.status in ('active', 'trial'))
          group by f.tenant_id) d
    order by (select max(g.scan_claimed_at) from platform.files g where g.tenant_id = d.tenant_id) nulls first,
             d.oldest, d.tenant_id
  loop
    select f.id into v_id from platform.files f
    where f.tenant_id = v_tenant and f.status in ('uploaded', 'scanning') and f.scan_not_before <= now()
      and (f.scan_leased_until is null or f.scan_leased_until <= now()) and f.purged_at is null
      and (f.housekeeping_leased_until is null or f.housekeeping_leased_until <= now())
    order by f.uploaded_at, f.id
    limit 1
    for update of f skip locked;
    exit when v_id is not null;
  end loop;
  if v_id is null then
    return;
  end if;
  update platform.files f
  set status = 'scanning', scan_leased_until = now() + interval '15 minutes', scan_claimed_at = now(),
      scan_attempts = least(f.scan_attempts + 1, 1000)
  where f.id = v_id;
  return query
    select f.id, f.tenant_id, f.bucket, f.object_key, f.purpose, f.declared_mime, f.size_bytes, p.max_bytes,
           p.allowed_types, f.scan_attempts::integer
    from platform.files f join platform.file_purposes p on p.purpose = f.purpose
    where f.id = v_id;
end
$$;
comment on function private.claim_file_scan() is
  'SECURITY-RELEVANT (T-M2-18). Worker: leases the next uploaded file for the type check and malware scan, organizations taking turns. app_worker system claims only.';

-- The scan's outcome, in the file's tenant transaction (system claims of that tenant): clean (type
-- allowed, size within the limit, hash), infected (finding), rejected (reason; the scanner's finding when
-- it could not look inside: encrypted, unscannable) or error (reason).
create or replace function private.finish_file_scan(
  p_file_id uuid, p_outcome text, p_detected_mime text, p_size bigint, p_sha256 text, p_engine text,
  p_signatures text, p_finding text, p_reason text)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_file record;
begin
  perform private.file_worker_check();
  if v_tenant is null then
    raise exception 'reserved to a job of the file''s organization' using errcode = 'insufficient_privilege';
  end if;
  if p_outcome is null or p_outcome not in ('clean', 'infected', 'rejected', 'error') then
    raise exception 'unknown scan outcome' using errcode = 'check_violation';
  end if;
  select f.*, p.max_bytes, p.allowed_types into v_file
  from platform.files f join platform.file_purposes p on p.purpose = f.purpose
  where f.id = p_file_id and f.tenant_id = v_tenant
  for update of f;
  if not found or v_file.status <> 'scanning' then
    return false;
  end if;
  if p_outcome = 'clean' then
    if p_detected_mime is null or not (p_detected_mime = any (v_file.allowed_types))
       or p_size is null or p_size < 1 or p_size > v_file.max_bytes or p_sha256 !~ '^[0-9a-f]{64}$'
       or p_engine is null or p_signatures is null then
      raise exception 'a clean file needs an allowed type, a size within the limit, its hash and the scan engine'
        using errcode = 'check_violation';
    end if;
    update platform.files f
    set status = 'clean', status_reason = null, detected_mime = p_detected_mime, size_bytes = p_size, sha256 = p_sha256,
        scan_engine = p_engine, scan_signatures = p_signatures, scan_finding = null, scanned_at = now(),
        scan_leased_until = null
    where f.id = p_file_id;
  elsif p_outcome = 'infected' then
    if p_finding is null or p_engine is null then
      raise exception 'an infected file needs the finding and the scan engine' using errcode = 'check_violation';
    end if;
    update platform.files f
    set status = 'infected', status_reason = 'malware', detected_mime = p_detected_mime, size_bytes = p_size,
        sha256 = p_sha256, scan_engine = p_engine, scan_signatures = p_signatures, scan_finding = p_finding,
        scanned_at = now(), scan_leased_until = null
    where f.id = p_file_id;
    delete from platform.file_download_grants g where g.file_id = p_file_id;
  else
    if p_reason is null then
      raise exception 'a rejected or failed file needs a reason' using errcode = 'check_violation';
    end if;
    update platform.files f
    set status = p_outcome, status_reason = p_reason, detected_mime = p_detected_mime, size_bytes = p_size,
        sha256 = p_sha256, scan_engine = p_engine, scan_signatures = p_signatures, scan_finding = p_finding,
        scanned_at = now(), scan_leased_until = null
    where f.id = p_file_id;
  end if;
  return true;
end
$$;
comment on function private.finish_file_scan(uuid, text, text, bigint, text, text, text, text, text) is
  'SECURITY-RELEVANT (T-M2-18). Worker: records the scan outcome (clean/infected/rejected/error) in the file''s tenant transaction. app_worker system claims of that tenant only.';

-- The scan could not finish (fail closed: the file stays `scanning`, never clean, and is tried again
-- after 15 s, 30 s, … at most every 15 minutes):
--   scanner     the scanner or Storage is unavailable — not the file's fault, so not counted against it;
--               but a file still without a verdict 24 hours after its upload becomes `error`
--               (scanner_unavailable; the worker logs it as an error to alert the operators).
--   processing  this file failed although the scanner answered (e.g. clamd dropped it, or its own limits
--               failed) — after 5 such failures it becomes `error` (processing_failed).
--   crash       clamd lost this file's stream and did not answer a PING right after: it probably crashed
--               on the file (and restarts). Counted for the file; at the 3rd it becomes `error`
--               (scanner_crashed) — a file that keeps killing the scanner must not take it down for every
--               organization (answer `crashed`; the worker writes a high-severity security event). Below
--               that, as `scanner`.
create or replace function private.retry_file_scan(p_file_id uuid, p_kind text)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_file record;
begin
  perform private.file_worker_check();
  if p_kind is null or p_kind not in ('scanner', 'processing', 'crash') then
    raise exception 'unknown retry kind' using errcode = 'check_violation';
  end if;
  select f.scan_attempts, f.scan_failures, f.scan_crashes, coalesce(f.uploaded_at, f.created_at) as uploaded_at
    into v_file
  from platform.files f where f.id = p_file_id and f.status = 'scanning' for update;
  if not found then
    return 'gone';
  end if;
  if p_kind = 'processing' and v_file.scan_failures + 1 >= 5 then
    update platform.files f
    set status = 'error', status_reason = 'processing_failed', scan_failures = least(f.scan_failures + 1, 1000),
        scan_leased_until = null
    where f.id = p_file_id;
    return 'error';
  end if;
  if p_kind = 'crash' and v_file.scan_crashes + 1 >= 3 then
    update platform.files f
    set status = 'error', status_reason = 'scanner_crashed', scan_crashes = least(f.scan_crashes + 1, 1000),
        scan_leased_until = null
    where f.id = p_file_id;
    return 'crashed';
  end if;
  if p_kind in ('scanner', 'crash') and v_file.uploaded_at < now() - interval '24 hours' then
    update platform.files f
    set status = 'error', status_reason = 'scanner_unavailable', scan_leased_until = null,
        scan_crashes = case when p_kind = 'crash' then least(f.scan_crashes + 1, 1000) else f.scan_crashes end
    where f.id = p_file_id;
    return 'error';
  end if;
  update platform.files f
  set scan_leased_until = null,
      scan_failures = case when p_kind = 'processing' then least(f.scan_failures + 1, 1000) else f.scan_failures end,
      scan_crashes = case when p_kind = 'crash' then least(f.scan_crashes + 1, 1000) else f.scan_crashes end,
      scan_not_before = now() + least(interval '15 minutes',
                                      make_interval(secs => 15 * power(2, least(greatest(v_file.scan_attempts - 1, 0), 10))))
  where f.id = p_file_id;
  return 'waiting';
end
$$;
comment on function private.retry_file_scan(uuid, text) is
  'SECURITY-RELEVANT (T-M2-18). Worker: puts a file back after a failed scan attempt (fail closed: it stays scanning); error after 5 failures of the file itself, 3 suspected scanner crashes on it, or when still without a verdict 24 hours after its upload. app_worker system claims only.';

-- Housekeeping (ADR 0006 §7). What is due for a file, if anything (one rule, used when leasing and again
-- under the row lock just before the Storage work):
--   quarantine     infected, object still in its upload bucket → move it to `quarantine`
--   remove_object  rejected, object not removed yet → delete the object, keep the record (30 days)
--   purge          retention reached → delete the object and the record: unconfirmed uploads after 24
--                  hours; import files 7 days after use, 24 hours if never used, at once when deleted;
--                  exports after 24 hours; owner-lifetime files 30 days after deletion; infected
--                  (quarantine) 30 days after the scan; rejected/failed records after 30 days.
--                  Record-retention files (≥ 10 years, DR-5) are never purged automatically.
-- Nothing while a worker is scanning the file (its lease), and nothing that destroys a file on legal hold
-- (removal and purge; the quarantine move keeps the object).
create or replace function private.file_housekeeping_action(f platform.files)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when f.purged_at is not null or (f.status = 'scanning' and f.scan_leased_until > now()) then null
    when f.status = 'infected' and f.bucket <> 'quarantine' and f.object_removed_at is null then 'quarantine'
    when f.legal_hold then null
    when (f.status = 'infected' and f.scanned_at < now() - interval '30 days')
         or (f.status in ('rejected', 'error') and f.created_at < now() - interval '30 days')
         or (f.status = 'pending_upload' and f.created_at < now() - interval '24 hours')
         or (f.status not in ('infected', 'rejected', 'error', 'pending_upload') and (
               (f.retention_class = 'import' and (f.status = 'deleted'
                  or (f.used_at is not null and f.used_at < now() - interval '7 days')
                  or (f.used_at is null and f.created_at < now() - interval '24 hours')))
               or (f.retention_class = 'export' and (f.status = 'deleted' or f.created_at < now() - interval '24 hours'))
               or (f.retention_class = 'owner_lifetime' and f.status = 'deleted'
                   and f.deleted_at < now() - interval '30 days'))) then 'purge'
    when f.status = 'rejected' and f.object_removed_at is null then 'remove_object'
  end
$$;
revoke all on function private.file_housekeeping_action(platform.files) from public;

-- Expired download grants are removed; then up to p_limit files that need Storage work are leased (10
-- minutes), each with its action (private.file_housekeeping_action).
create or replace function private.claim_file_housekeeping(p_limit integer)
returns table (id uuid, tenant_id uuid, bucket text, object_key text, action text)
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.file_worker_check();
  delete from platform.file_download_grants g where g.expires_at < now() - interval '1 hour';
  return query
  with due as (
    select f.id, private.file_housekeeping_action(f) as action
    from platform.files f
    where f.purged_at is null and (f.housekeeping_leased_until is null or f.housekeeping_leased_until <= now())
  ),
  picked as (
    select f.id, d.action from platform.files f join due d on d.id = f.id
    where d.action is not null
    order by f.created_at, f.id
    limit greatest(least(coalesce(p_limit, 50), 500), 1)
    for update of f skip locked
  ),
  leased as (
    update platform.files f set housekeeping_leased_until = now() + interval '10 minutes'
    from picked
    where f.id = picked.id
    returning f.id, f.tenant_id, f.bucket, f.object_key, picked.action
  )
  select l.id, l.tenant_id, l.bucket, l.object_key, l.action from leased l;
end
$$;
comment on function private.claim_file_housekeeping(integer) is
  'SECURITY-RELEVANT (ADR 0006 §7, T-M2-18). Worker: removes expired download grants and leases files due for quarantine, object removal or purge (legal hold respected). app_worker system claims only.';

-- Just before the Storage work of a leased action, in the same transaction as that work and its
-- finish_file_housekeeping: locks the file's row and answers whether the action is STILL due — a legal hold
-- set, a use recorded or a scan lease taken since the lease was handed out stops it. Whoever changes the
-- file meanwhile waits for this transaction, so no hold can slip in between the check and the removal.
create or replace function private.lock_file_housekeeping(p_file_id uuid, p_action text)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_file platform.files%rowtype;
begin
  perform private.file_worker_check();
  if p_action is null or p_action not in ('quarantine', 'remove_object', 'purge') then
    raise exception 'unknown housekeeping action' using errcode = 'check_violation';
  end if;
  select f.* into v_file from platform.files f where f.id = p_file_id for update;
  if not found then
    return false;
  end if;
  return private.file_housekeeping_action(v_file) is not distinct from p_action;
end
$$;
comment on function private.lock_file_housekeeping(uuid, text) is
  'SECURITY-RELEVANT (ADR 0006 §7, T-M2-18). Worker: locks a file and re-checks, just before its Storage work, that the housekeeping action is still due (legal hold, use, scan lease). app_worker system claims only.';

-- After the Storage work of a housekeeping action: record it. A purge deletes the record; when a business
-- row still references the file (foreign key), the record stays as a tombstone without its name.
create or replace function private.finish_file_housekeeping(p_file_id uuid, p_action text)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.file_worker_check();
  if p_action = 'quarantine' then
    update platform.files f set bucket = 'quarantine', quarantined_at = now(), housekeeping_leased_until = null
    where f.id = p_file_id and f.status = 'infected' and f.bucket <> 'quarantine';
    return found;
  elsif p_action = 'remove_object' then
    update platform.files f set object_removed_at = now(), housekeeping_leased_until = null
    where f.id = p_file_id and f.status = 'rejected' and f.object_removed_at is null and not f.legal_hold;
    return found;
  elsif p_action = 'purge' then
    if exists (select 1 from platform.files f where f.id = p_file_id and f.legal_hold) then
      return false;
    end if;
    begin
      delete from platform.files f where f.id = p_file_id;
      return found;
    exception when foreign_key_violation then
      update platform.files f
      set purged_at = now(), object_removed_at = coalesce(f.object_removed_at, now()), original_name = 'deleted',
          housekeeping_leased_until = null, scan_leased_until = null,
          status = case when f.status in ('pending_upload', 'uploaded', 'scanning', 'clean', 'rejected', 'error')
                        then 'deleted' else f.status end,
          deleted_at = coalesce(f.deleted_at, now())
      where f.id = p_file_id;
      return found;
    end;
  end if;
  raise exception 'unknown housekeeping action' using errcode = 'check_violation';
end
$$;
comment on function private.finish_file_housekeeping(uuid, text) is
  'SECURITY-RELEVANT (T-M2-18). Worker: records a quarantine move, an object removal or a purge (record deleted, or kept as a tombstone while referenced). app_worker system claims only.';

-- Orphan objects (ADR 0006 §7): objects in our buckets that no live file record owns — a generated file
-- whose job rolled back after writing it, or an object a still-valid signed upload URL created again after
-- the file was quarantined, its object removed, or purged. Only objects older than the longest signed
-- upload URL lifetime (hosted Supabase: 2 hours; self-hosted: 15 minutes) plus a margin: 3 hours — so no
-- upload or generated-file write in flight is touched, and an object created again with a URL is removed
-- once that URL has expired. Owner: the file whose id is the key's last segment, with that key, neither
-- purged nor its object removed, in that bucket — or in quarantine while infected (the move and its
-- record are not atomic). Keys of another shape are not ours to remove (operators').
create or replace function private.claim_orphan_objects(p_limit integer)
returns table (bucket text, object_key text, orphans bigint, objects bigint)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.file_worker_check();
  -- With each row: how many orphans there are in all, and how many objects our buckets hold — the worker
  -- removes nothing above its brake (a restore, or a fault that lost records, looks like mass orphans).
  return query
    with orphan as (
      select o.bucket_id, o.name, o.created_at
      from private.storage_object_facts o
      where o.bucket_id in ('materials', 'images', 'evidence', 'imports', 'generated', 'quarantine')
        and o.created_at < now() - interval '3 hours'
        and o.name ~ '^[0-9a-f-]{36}(/[a-z0-9_-]{1,64}){2}/[0-9a-f-]{36}/[0-9a-f-]{36}$'
        and not exists (
          select 1 from platform.files f
          where f.id = private.try_uuid(split_part(o.name, '/', 5)) and f.object_key = o.name
            and f.purged_at is null and f.object_removed_at is null
            and (f.bucket = o.bucket_id or (o.bucket_id = 'quarantine' and f.status = 'infected')))
    ),
    totals as (
      select (select count(*) from orphan) as orphans,
             (select count(*) from private.storage_object_facts o
              where o.bucket_id in ('materials', 'images', 'evidence', 'imports', 'generated', 'quarantine')) as objects
    )
    select picked.bucket_id, picked.name, t.orphans, t.objects
    from (select r.bucket_id, r.name, r.created_at from orphan r
          order by r.created_at, r.bucket_id, r.name
          limit greatest(least(coalesce(p_limit, 100), 500), 1)) picked
    cross join totals t
    order by picked.created_at, picked.bucket_id, picked.name;
end
$$;
comment on function private.claim_orphan_objects(integer) is
  'SECURITY-RELEVANT (ADR 0006 §7, T-M2-18). Worker: objects in our buckets older than 3 hours that no live file record owns, with the number of orphans and of objects (the worker brakes above its limits before removing any). app_worker system claims only.';

-- Generated files (e.g. an import's error report, T-M2-12): a job of the tenant reserves the key, uploads
-- the bytes it produced with the worker's Storage access, then marks the file clean with its size and hash
-- (generated from scanned inputs; never user bytes). p_for_user: the user it is made for (they see it as
-- theirs: getFileStatus, deleteFile), who must be an active member of the tenant.
create or replace function private.create_generated_file(
  p_purpose text, p_owner_module text, p_owner_entity_type text, p_owner_entity_id uuid, p_original_name text,
  p_mime text, p_size bigint, p_for_user uuid)
returns table (id uuid, bucket text, object_key text)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_purpose record;
  v_id uuid := gen_random_uuid();
begin
  perform private.file_worker_check();
  if v_tenant is null then
    raise exception 'reserved to a job of the organization' using errcode = 'insufficient_privilege';
  end if;
  select p.* into v_purpose from platform.file_purposes p where p.purpose = p_purpose and p.upload_by = 'worker';
  if not found then
    raise exception 'unknown purpose' using errcode = 'JF003';
  end if;
  if p_mime is null or not (p_mime = any (v_purpose.allowed_types)) then
    raise exception 'type not allowed for this purpose' using errcode = 'JF001';
  end if;
  if p_size is null or p_size < 1 or p_size > v_purpose.max_bytes then
    raise exception 'file too large' using errcode = 'JF002';
  end if;
  if p_for_user is not null and not exists (
       select 1 from platform.tenant_memberships m where m.tenant_id = v_tenant and m.user_id = p_for_user
         and m.status = 'active') then
    raise exception 'the user is not an active member' using errcode = 'insufficient_privilege';
  end if;
  insert into platform.files as f (id, tenant_id, bucket, object_key, purpose, owner_module, owner_entity_type,
                                   owner_entity_id, original_name, declared_mime, declared_size, retention_class,
                                   created_by_user, upload_expires_at)
  values (v_id, v_tenant, v_purpose.bucket,
          v_tenant::text || '/' || p_owner_module || '/' || p_owner_entity_type || '/' || p_owner_entity_id::text || '/' || v_id::text,
          p_purpose, p_owner_module, p_owner_entity_type, p_owner_entity_id, p_original_name, p_mime, p_size,
          v_purpose.retention_class, p_for_user, now() + interval '15 minutes');
  return query select f.id, f.bucket, f.object_key from platform.files f where f.id = v_id;
end
$$;
comment on function private.create_generated_file(text, text, text, uuid, text, text, bigint, uuid) is
  'SECURITY-RELEVANT (T-M2-18). Worker: reserves a generated file (worker purposes only) in the job''s tenant. app_worker system claims of that tenant only.';

create or replace function private.finish_generated_file(p_file_id uuid, p_size bigint, p_sha256 text)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
begin
  perform private.file_worker_check();
  if v_tenant is null then
    raise exception 'reserved to a job of the organization' using errcode = 'insufficient_privilege';
  end if;
  update platform.files f
  set status = 'clean', detected_mime = f.declared_mime, size_bytes = p_size, sha256 = p_sha256, uploaded_at = now(),
      scanned_at = now(), scan_engine = 'generated', scan_signatures = 'none'
  where f.id = p_file_id and f.tenant_id = v_tenant and f.status = 'pending_upload' and p_size = f.declared_size
    and p_sha256 ~ '^[0-9a-f]{64}$'
    and exists (select 1 from platform.file_purposes p where p.purpose = f.purpose and p.upload_by = 'worker')
    and exists (select 1 from private.storage_object_facts o where o.bucket_id = f.bucket and o.name = f.object_key);
  return found;
end
$$;
comment on function private.finish_generated_file(uuid, bigint, text) is
  'SECURITY-RELEVANT (T-M2-18). Worker: a generated file whose bytes were stored becomes clean (size and hash recorded). app_worker system claims of its tenant only.';

-- ---------------------------------------------------------------------------------------------------
-- Ownership hand-over (non-superuser migration role on hosted Supabase, as in 20260930120100)
-- ---------------------------------------------------------------------------------------------------
grant create on schema private to tenant_guard;
alter function private.storage_request_tenant() owner to tenant_guard;
revoke create on schema private from tenant_guard;

grant create on schema private to file_guard;
alter function private.file_user_tenant() owner to file_guard;
alter function private.file_for_actor(uuid) owner to file_guard;
alter function private.file_worker_check() owner to file_guard;
alter function private.create_file_upload(text, text, text, uuid, text, text, bigint) owner to file_guard;
alter function private.confirm_file_upload(uuid) owner to file_guard;
alter function private.grant_file_download(uuid, text, text, text, uuid) owner to file_guard;
alter function private.delete_file(uuid) owner to file_guard;
alter function private.mark_file_used(uuid) owner to file_guard;
alter function private.can_upload_object(text, text) owner to file_guard;
alter function private.can_read_object(text, text) owner to file_guard;
alter function private.claim_file_scan() owner to file_guard;
alter function private.finish_file_scan(uuid, text, text, bigint, text, text, text, text, text) owner to file_guard;
alter function private.retry_file_scan(uuid, text) owner to file_guard;
alter function private.file_housekeeping_action(platform.files) owner to file_guard;
alter function private.claim_file_housekeeping(integer) owner to file_guard;
alter function private.lock_file_housekeeping(uuid, text) owner to file_guard;
alter function private.finish_file_housekeeping(uuid, text) owner to file_guard;
alter function private.claim_orphan_objects(integer) owner to file_guard;
alter function private.create_generated_file(text, text, text, uuid, text, text, bigint, uuid) owner to file_guard;
alter function private.finish_generated_file(uuid, bigint, text) owner to file_guard;
revoke create on schema private from file_guard;

revoke all on function private.storage_request_tenant() from public;
revoke all on function private.file_user_tenant() from public;
revoke all on function private.file_for_actor(uuid) from public;
revoke all on function private.file_worker_check() from public;
revoke all on function private.create_file_upload(text, text, text, uuid, text, text, bigint) from public;
revoke all on function private.confirm_file_upload(uuid) from public;
revoke all on function private.grant_file_download(uuid, text, text, text, uuid) from public;
revoke all on function private.delete_file(uuid) from public;
revoke all on function private.mark_file_used(uuid) from public;
revoke all on function private.can_upload_object(text, text) from public;
revoke all on function private.can_read_object(text, text) from public;
revoke all on function private.claim_file_scan() from public;
revoke all on function private.finish_file_scan(uuid, text, text, bigint, text, text, text, text, text) from public;
revoke all on function private.retry_file_scan(uuid, text) from public;
revoke all on function private.file_housekeeping_action(platform.files) from public;
revoke all on function private.claim_file_housekeeping(integer) from public;
revoke all on function private.lock_file_housekeeping(uuid, text) from public;
revoke all on function private.finish_file_housekeeping(uuid, text) from public;
revoke all on function private.claim_orphan_objects(integer) from public;
revoke all on function private.create_generated_file(text, text, text, uuid, text, text, bigint, uuid) from public;
revoke all on function private.finish_generated_file(uuid, bigint, text) from public;

-- Storage's tenant: the storage policies (run as authenticated) and file_guard's checks.
grant execute on function private.storage_request_tenant() to authenticated, file_guard;
-- The helpers run inside file_guard's functions only.
grant execute on function private.file_user_tenant() to file_guard;
grant execute on function private.file_for_actor(uuid) to file_guard;
grant execute on function private.file_worker_check() to file_guard;
-- Called inside `set local role authenticated` transactions (withUserTx / withSystemTx / withPlatformTx, and
-- Storage's own); each function checks the LOGIN role and the claims itself.
grant execute on function private.create_file_upload(text, text, text, uuid, text, text, bigint) to authenticated;
grant execute on function private.confirm_file_upload(uuid) to authenticated;
grant execute on function private.grant_file_download(uuid, text, text, text, uuid) to authenticated;
grant execute on function private.delete_file(uuid) to authenticated;
grant execute on function private.mark_file_used(uuid) to authenticated;
grant execute on function private.can_upload_object(text, text) to authenticated;
grant execute on function private.can_read_object(text, text) to authenticated;
grant execute on function private.claim_file_scan() to authenticated;
grant execute on function private.finish_file_scan(uuid, text, text, bigint, text, text, text, text, text) to authenticated;
grant execute on function private.retry_file_scan(uuid, text) to authenticated;
grant execute on function private.claim_file_housekeeping(integer) to authenticated;
grant execute on function private.lock_file_housekeeping(uuid, text) to authenticated;
grant execute on function private.finish_file_housekeeping(uuid, text) to authenticated;
grant execute on function private.claim_orphan_objects(integer) to authenticated;
grant execute on function private.create_generated_file(text, text, text, uuid, text, text, bigint, uuid) to authenticated;
grant execute on function private.finish_generated_file(uuid, bigint, text) to authenticated;
