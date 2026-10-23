-- Rollback of 20261026100000_platform__add_remembered_browser_days.sql.
create or replace function private.security_policy_changed_mail()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_changed text[];
begin
  v_changed := array_remove(array[
    case when old.mfa_mode is distinct from new.mfa_mode then 'mfaMode' end,
    case when old.mfa_required_roles is distinct from new.mfa_required_roles then 'mfaRequiredRoles' end,
    case when old.mfa_grace_days is distinct from new.mfa_grace_days then 'mfaGraceDays' end,
    case when old.mfa_prompt_admins is distinct from new.mfa_prompt_admins then 'mfaPromptAdmins' end,
    case when old.password_min_length is distinct from new.password_min_length then 'passwordMinLength' end,
    case when old.lockout_threshold is distinct from new.lockout_threshold then 'lockoutThreshold' end,
    case when old.lockout_minutes is distinct from new.lockout_minutes then 'lockoutMinutes' end,
    case when old.session_idle_minutes is distinct from new.session_idle_minutes then 'sessionIdleMinutes' end,
    case when old.session_max_hours is distinct from new.session_max_hours then 'sessionMaxHours' end,
    case when old.session_max_devices is distinct from new.session_max_devices then 'sessionMaxDevices' end
  ], null);
  if cardinality(v_changed) = 0 then
    return null;
  end if;
  delete from private.account_mail_requests r
  where r.kind = 'security_policy_changed' and private.account_mail_request_expired(r.kind, r.created_at);
  insert into private.account_mail_requests (kind, user_id, tenant_id, detail)
  select distinct 'security_policy_changed', m.user_id, new.tenant_id,
         jsonb_build_object('changed', to_jsonb(v_changed), 'changed_by', new.updated_by, 'changed_at', now())
  from platform.tenant_memberships m
  join platform.role_assignments ra on ra.tenant_id = m.tenant_id and ra.membership_id = m.id
  where m.tenant_id = new.tenant_id and m.status = 'active' and m.user_id is not null
    and ra.role_code = 'tenant_admin'
    and (ra.valid_from is null or ra.valid_from <= now()) and (ra.valid_until is null or ra.valid_until > now())
    and (select count(*) from (select 1 from private.account_mail_requests limit 10000) w) < 10000;
  return null;
end
$$;
revoke all on function private.security_policy_changed_mail() from public;
revoke update (remembered_browser_days) on platform.security_policies from authenticated;
alter table platform.security_policies drop column remembered_browser_days;
