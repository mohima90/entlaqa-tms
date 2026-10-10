-- Rollback of 20261016090200_private__user_import_processing.sql: the processing functions of user imports.
drop function private.user_import_undo_batch(uuid, integer);
drop function private.user_import_release_next(uuid, interval, integer, integer);
drop function private.user_import_result_counts(uuid);
drop function private.user_import_finish_rows(uuid);
drop function private.user_import_apply_batch(uuid, integer);
drop function private.user_import_recheck(uuid);
drop function private.user_import_write_person(uuid, uuid, jsonb, text);
drop function private.user_import_person_before(uuid, uuid, jsonb, uuid, uuid, uuid);
drop function private.user_import_review_counts(uuid);
drop function private.user_import_classify(uuid);
drop function private.user_import_changes(uuid, uuid, jsonb, uuid, uuid, uuid, text);
drop function private.user_import_lock_tenant(uuid);
drop function private.user_import_issue(text, text, text, jsonb);
drop function private.user_import_job_tenant();
