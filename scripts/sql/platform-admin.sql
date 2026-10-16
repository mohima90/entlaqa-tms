-- Grants or revokes the Platform Super Admin role of an Auth user (FR-ADM-17; runbook:
-- docs/engineering/platform-console.md). Run by scripts/platform-admin.sh only, as the migration role (the
-- only role allowed to execute private.grant_platform_admin / revoke_platform_admin). Values arrive as psql
-- variables (quoted by psql with :'name', never spliced into SQL text) and are re-validated here. The
-- caller wraps this file in one transaction and decides between COMMIT (apply) and ROLLBACK (plan).
--
--   :'admin_user_id'   the Auth user's UID (Supabase: Authentication → Users → Copy UID); never an e-mail,
--                      so no personal data in workflow inputs or logs
--   :'admin_action'    'grant' | 'revoke'
--
-- An unknown UID is refused (the user must exist in Auth first). Granting an existing Super Admin and
-- revoking a non-admin change nothing (reported). Each change is written to private.platform_audit_events.

select set_config('platform_admin.user_id', :'admin_user_id', true),
       set_config('platform_admin.action', :'admin_action', true);

do $$
declare
  v_user_text text := lower(current_setting('platform_admin.user_id'));
  v_action text := current_setting('platform_admin.action');
  v_user uuid;
begin
  if v_user_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'platform-admin: admin_user_id must be a UUID (the user''s UID in Supabase Auth)';
  end if;
  v_user := v_user_text::uuid;
  if v_action = 'grant' then
    if private.grant_platform_admin(v_user) then
      raise notice 'platform-admin: the user is now a Platform Super Admin';
    else
      raise notice 'platform-admin: the user is already a Platform Super Admin; nothing to do';
    end if;
  elsif v_action = 'revoke' then
    if private.revoke_platform_admin(v_user) then
      raise notice 'platform-admin: the user is no longer a Platform Super Admin';
    else
      raise notice 'platform-admin: the user is not a Platform Super Admin; nothing to do';
    end if;
  else
    raise exception 'platform-admin: action must be grant or revoke';
  end if;
end
$$;
