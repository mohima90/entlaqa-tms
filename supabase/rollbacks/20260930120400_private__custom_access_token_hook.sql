-- Rollback of 20260930120400_private__custom_access_token_hook.sql (docs/architecture/migration-conventions.md §6).
-- Not run automatically in production; tested by scripts/db-test.sh (up → down → up).
-- Disable the hook in Auth configuration BEFORE running this, or token issuance fails.
revoke execute on function private.try_uuid(text) from supabase_auth_admin;
drop function private.custom_access_token_hook(jsonb);
revoke usage on schema private from supabase_auth_admin;
