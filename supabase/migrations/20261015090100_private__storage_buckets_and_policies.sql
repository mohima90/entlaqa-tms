-- Storage buckets and storage.objects policies (ADR 0006 §1, §4; ADR 0002 §8; T-M2-18).
--
-- All buckets are PRIVATE. Their size limit and declared-type list are Storage's first line of defence
-- (they trust the client's Content-Type); the authoritative check is the worker's content detection and
-- malware scan (platform.files status, migration 20261015090000).
--
-- Policies on storage.objects (Supabase Storage evaluates them with the caller's JWT as `authenticated`
-- under its own login role; private.storage_request_tenant() validates those claims). Hosted Supabase lets
-- its migration role create policies on storage.objects (supautils.policy_grants) and insert buckets
-- (storage migration 0049: ALL on storage.buckets WITH GRANT OPTION) — checked on supabase/postgres
-- 17.11.0.003 + storage-api v1.74.0, and by the DB deploy dry run on staging.
--   jadarat_tenant_prefix  RESTRICTIVE, every command: the object's first folder is the caller's validated
--                          tenant — no other policy, ever, can widen access across tenants.
--   jadarat_files_upload   INSERT: exactly a pending upload of this user (private.can_upload_object). Storage
--                          checks it when the web app asks for a signed upload URL with the user's session.
--   jadarat_files_read     SELECT: a clean file with an unexpired download grant for the caller
--                          (private.can_read_object). Storage checks it when a signed download URL is made.
-- No UPDATE or DELETE policy: objects are immutable for users (no upsert); quarantine moves and removals
-- are the worker's (Storage API with the secret key, worker only).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('materials', 'materials', false, 209715200, array[
     'application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'video/mp4', 'audio/mpeg', 'image/png',
     'image/jpeg', 'image/webp', 'application/zip']),
  ('images', 'images', false, 10485760, array['image/png', 'image/jpeg', 'image/webp']),
  ('evidence', 'evidence', false, 26214400, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
  ('imports', 'imports', false, 20971520,
   array['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  -- Written by the worker only (no user can hold a pending upload there).
  ('generated', 'generated', false, 104857600, null),
  ('quarantine', 'quarantine', false, null, null)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy jadarat_tenant_prefix on storage.objects
  as restrictive for all to authenticated
  using (split_part(name, '/', 1) = (select private.storage_request_tenant())::text)
  with check (split_part(name, '/', 1) = (select private.storage_request_tenant())::text);

create policy jadarat_files_upload on storage.objects for insert to authenticated
  with check (private.can_upload_object(bucket_id, name));

create policy jadarat_files_read on storage.objects for select to authenticated
  using (private.can_read_object(bucket_id, name));
