-- Rollback of 20261016090000_platform__user_imports.sql. Run the rollbacks of 20261016090200, 20261016090150 and
-- 20261016090100 first. The cluster-wide role user_import_guard is kept (other databases may use it); its
-- privileges here are removed. The imports' files stay in platform.files (purged by the file housekeeping
-- per their retention class).
drop function private.claim_user_import_work();
drop function private.user_import_worker_check();
drop function private.user_import_step(uuid, uuid, text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, text);

drop table platform.user_import_rows;
drop table platform.user_import_columns;
drop table platform.user_imports;
drop function private.check_user_import();
drop function private.user_import_mapping_is_valid(jsonb);
drop function private.user_import_draft_statuses();
drop function private.user_import_actor_may_import(uuid, uuid);

drop policy files_user_import_guard_read on platform.files;
revoke all on platform.files from user_import_guard;
drop policy tenants_user_import_guard_read on platform.tenants;
revoke all on platform.tenants from user_import_guard;
revoke execute on function private.request_claims() from user_import_guard;
revoke execute on function private.try_uuid(text) from user_import_guard;
revoke execute on function private.request_user_id() from user_import_guard;
revoke execute on function private.has_visible_text(text) from user_import_guard;

revoke usage on schema platform, private from user_import_guard;
revoke user_import_guard from current_user;
