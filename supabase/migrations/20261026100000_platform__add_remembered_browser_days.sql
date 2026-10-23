-- «Remember this browser» = «keep me signed in» (WP-ADM-05, FR-IAM-12; business flow EP-AUTH-signin-extras, PO
-- answers 21 Oct 2026 #5 and 23 Oct 2026): how long a session the person chose to keep stays signed in on its
-- browser - Off / 1 / 7 / 14 / 30 days, default Off (0). Class: T. No personal data.
--
--   platform.security_policies.remembered_browser_days  0 (off, the default for every organization), 1, 7, 14
--                           or 30. Written by the Organization Admin at AAL2 with the other security settings
--                           (policy security_policies_update); read when a session is kept (20261026100100:
--                           the strictest organization of the account wins).
--   private.security_policy_changed_mail()  the change notice to every Organization Admin also names this
--                           setting (`rememberedBrowserDays`, never the value).
-- Expand-first: a column with a default; older code never sees it.

alter table platform.security_policies add column remembered_browser_days smallint not null default 0;
alter table platform.security_policies add constraint security_policies_remembered_browser_days_check
  check (remembered_browser_days in (0, 1, 7, 14, 30));
comment on column platform.security_policies.remembered_browser_days is
  'How many days a session kept with "Remember this browser" stays signed in: 0 (off), 1, 7, 14 or 30 (WP-ADM-05).';

grant update (remembered_browser_days) on platform.security_policies to authenticated;

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
    case when old.session_max_devices is distinct from new.session_max_devices then 'sessionMaxDevices' end,
    case when old.remembered_browser_days is distinct from new.remembered_browser_days then 'rememberedBrowserDays' end
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

comment on function private.security_policy_changed_mail() is
  'SECURITY-RELEVANT (T-M2-10, TM-0003 T-IAM-24). Trigger: queues the security-policy-change notice for every Organization Admin of the organization (setting names and editor only). tenant_guard only.';

grant create on schema private to tenant_guard;
alter function private.security_policy_changed_mail() owner to tenant_guard;
revoke create on schema private from tenant_guard;
revoke all on function private.security_policy_changed_mail() from public;
