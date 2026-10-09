-- Rollback of 20261011090100_private__sign_in_refusal.sql: the hook as in 20260930120400 (deactivated
-- members can then sign in to Auth again — they still reach no organization: the database refuses their
-- claims), and the rule's function, view, index and membership_guard's read access removed.
create or replace function private.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_user uuid := private.try_uuid(event ->> 'user_id');
  v_session uuid := private.try_uuid(event -> 'claims' ->> 'session_id');
  v_tenant uuid;
  v_person uuid;
begin
  v_claims := v_claims - 'tenant_id' - 'person_id';

  if v_user is not null and v_session is not null then
    select m.tenant_id, m.person_id
      into v_tenant, v_person
    from platform.session_context c
    join platform.tenant_memberships m
      on m.tenant_id = c.active_tenant_id and m.user_id = c.user_id
    join platform.tenants t on t.id = m.tenant_id
    where c.session_id = v_session
      and c.user_id = v_user
      and m.status = 'active'
      and t.status in ('active', 'trial');
  end if;

  if v_tenant is not null then
    v_claims := v_claims || jsonb_build_object('tenant_id', v_tenant, 'person_id', v_person);
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end
$$;

comment on function private.custom_access_token_hook(jsonb) is
  'SECURITY-RELEVANT (ADR 0002 §3). Supabase Custom Access Token Hook: tenant_id/person_id for the session''s active tenant.';

drop function private.account_sign_in_refused(uuid);

drop index platform.invitations_pending_email_idx;
drop policy invitations_membership_guard_read on platform.invitations;
revoke all on platform.invitations from membership_guard;
drop policy tenants_membership_guard_read on platform.tenants;
revoke all on platform.tenants from membership_guard;

drop view private.auth_account_email;
