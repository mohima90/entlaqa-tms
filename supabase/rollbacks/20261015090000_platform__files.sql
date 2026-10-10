-- Rollback of 20261015090000_platform__files.sql. Run the storage policies rollback (…090100) first. The
-- cluster-wide role file_guard is kept (other databases may use it); its privileges here are removed.
-- Stored objects are NOT removed: empty the buckets through the Storage API first if that is intended.
drop function private.finish_generated_file(uuid, bigint, text);
drop function private.create_generated_file(text, text, text, uuid, text, text, bigint, uuid);
drop function private.claim_orphan_objects(integer);
drop function private.finish_file_housekeeping(uuid, text);
drop function private.lock_file_housekeeping(uuid, text);
drop function private.claim_file_housekeeping(integer);
drop function private.file_housekeeping_action(platform.files);
drop function private.retry_file_scan(uuid, text);
drop function private.finish_file_scan(uuid, text, text, bigint, text, text, text, text, text);
drop function private.claim_file_scan();
drop function private.file_worker_check();
drop function private.can_read_object(text, text);
drop function private.can_upload_object(text, text);
drop function private.mark_file_used(uuid);
drop function private.delete_file(uuid);
drop function private.file_for_actor(uuid);
drop function private.grant_file_download(uuid, text, text, text, uuid);
drop function private.confirm_file_upload(uuid);
drop function private.create_file_upload(text, text, text, uuid, text, text, bigint);
drop function private.file_user_tenant();
drop function private.storage_request_tenant();

drop table platform.file_download_grants;
drop table platform.files;
drop function private.files_transition();
drop view private.storage_object_facts;
drop table platform.file_purposes;

revoke execute on function private.try_uuid(text) from file_guard;
revoke execute on function private.request_claims() from file_guard;
revoke execute on function private.request_user_id() from file_guard;
revoke execute on function private.request_person_id() from file_guard;
revoke execute on function private.current_tenant_id() from file_guard;

drop policy tenant_memberships_file_guard_read on platform.tenant_memberships;
revoke all on platform.tenant_memberships from file_guard;
drop policy tenants_file_guard_read on platform.tenants;
revoke all on platform.tenants from file_guard;

revoke usage on schema platform, private from file_guard;
revoke file_guard from current_user;
