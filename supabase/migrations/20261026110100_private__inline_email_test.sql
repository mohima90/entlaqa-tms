-- The test e-mail of the two e-mail settings pages, sent the moment the action commits (WP-ADM-05 follow-up; PO
-- 23 Oct 2026: "every e-mail arrives immediately", the test e-mail on both settings pages included). Class: P.
-- No new personal data: the recipient is the one the admin typed, kept (as before) until the test is final.
--
-- The worker claims waiting tests (private.claim_email_tests) and records them (finish_email_test). The web app
-- may now do the same for the caller's OWN test, inside the action's transaction (the Super Admin for the
-- platform sender, a member with platform.tenant.manage for the organization's provider): the claim sets the
-- same `sending` state and lease the worker honours (5 minutes, 3 claims) and stores the SHA-256 of a secret
-- only this request holds; after the response the web app sends the test through the settings being tested and
-- records the outcome with that secret - no claims needed, nothing else reachable. A test nobody finished is
-- claimed by the worker after the lease, as before (the safety net).
--
--   private.inline_email_test_claim(scope, secret_hash)   web app, user claims: the caller's own test + settings
--   private.inline_email_test_finish(secret, version, sent, error_code)   web app: the outcome (verifies the
--                       settings it proved, audited, exactly like the worker's finish_email_test)
-- Expand-first: new nullable columns and functions only.

alter table private.platform_email_settings
  add column test_claim_hash bytea,
  add constraint platform_email_settings_claim_hash_check
    check (test_claim_hash is null or octet_length(test_claim_hash) = 32);
alter table private.tenant_email_settings
  add column test_claim_hash bytea,
  add constraint tenant_email_settings_claim_hash_check
    check (test_claim_hash is null or octet_length(test_claim_hash) = 32);
comment on column private.platform_email_settings.test_claim_hash is
  'SHA-256 of the secret of the web request that claimed the test for an immediate send (WP-ADM-05 follow-up).';
comment on column private.tenant_email_settings.test_claim_hash is
  'SHA-256 of the secret of the web request that claimed the test for an immediate send (WP-ADM-05 follow-up).';

-- The caller's own waiting test, claimed in the action's transaction. No rows: nothing waiting (or the test
-- was claimed three times already - the worker fails it).
create or replace function private.inline_email_test_claim(p_scope text, p_secret_hash bytea)
returns table (tenant_id uuid, recipient text, version integer, provider text, options jsonb,
               credentials_sealed text, from_name text, from_address text, reply_to text)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if p_secret_hash is null or octet_length(p_secret_hash) <> 32 then
    raise exception 'invalid claim' using errcode = 'invalid_parameter_value';
  end if;
  if p_scope = 'platform' then
    perform private.platform_admin_caller();
    return query
      with claimed as (
        update private.platform_email_settings s
        set test_status = 'sending', test_claimed_at = now(), test_attempts = least(s.test_attempts + 1, 100),
            test_claim_hash = p_secret_hash
        where s.id = 1 and s.test_attempts < 3
          and (s.test_status = 'queued'
               or (s.test_status = 'sending' and s.test_claimed_at < now() - interval '5 minutes'))
        returning null::uuid, s.test_recipient, s.version, s.provider, s.options, s.credentials_sealed,
                  s.from_name, s.from_address, null::text)
      select * from claimed;
  elsif p_scope = 'tenant' then
    v_tenant := private.email_member_tenant(true);
    return query
      with claimed as (
        update private.tenant_email_settings s
        set test_status = 'sending', test_claimed_at = now(), test_attempts = least(s.test_attempts + 1, 100),
            test_claim_hash = p_secret_hash
        where s.tenant_id = v_tenant and s.test_attempts < 3
          and (s.test_status = 'queued'
               or (s.test_status = 'sending' and s.test_claimed_at < now() - interval '5 minutes'))
        returning s.tenant_id, s.test_recipient, s.version, s.provider, s.options, s.credentials_sealed,
                  s.from_name, s.from_address, s.reply_to)
      select * from claimed;
  else
    raise exception 'invalid scope' using errcode = 'invalid_parameter_value';
  end if;
end
$$;
comment on function private.inline_email_test_claim(text, bytea) is
  'SECURITY-RELEVANT (WP-ADM-05 follow-up). Claims the caller''s own waiting test e-mail (the Super Admin''s platform sender, or the organization''s provider for a member with tenant.manage) for an immediate send under the worker''s lease. app_server user claims only.';

create or replace function private.inline_email_test_finish(p_secret bytea, p_version integer, p_sent boolean,
                                                             p_error_code text)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_tenant uuid;
  v_verified boolean := false;
  v_found boolean := false;
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  if p_secret is null or octet_length(p_secret) <> 32 then
    return false;
  end if;
  if p_sent is null or (not p_sent and (p_error_code is null or p_error_code !~ '^[A-Z0-9_]{2,64}$')) then
    raise exception 'error_code' using errcode = 'JE001';
  end if;
  v_hash := pg_catalog.sha256(p_secret);
  update private.platform_email_settings s
  set test_status = case when p_sent then 'sent' else 'failed' end,
      test_error_code = case when p_sent then null else p_error_code end,
      test_recipient = null, test_finished_at = now(), test_claim_hash = null,
      status = case when p_sent and s.version = p_version then 'verified' else s.status end,
      verified_at = case when p_sent and s.version = p_version then now() else s.verified_at end
  where s.id = 1 and s.test_status = 'sending' and s.test_claim_hash = v_hash
  returning p_sent and s.version = p_version into v_verified;
  v_found := found;
  if v_found then
    if v_verified then
      insert into private.platform_audit_events (actor_user_id, action, entity_type, entity_id, data)
      values (null, 'platform.email.sender_verified', 'platform_email_settings', '1',
              jsonb_build_object('version', p_version, 'immediate', true));
    end if;
    return v_verified;
  end if;
  update private.tenant_email_settings s
  set test_status = case when p_sent then 'sent' else 'failed' end,
      test_error_code = case when p_sent then null else p_error_code end,
      test_recipient = null, test_finished_at = now(), test_claim_hash = null,
      status = case when p_sent and s.version = p_version then 'verified' else s.status end,
      verified_at = case when p_sent and s.version = p_version then now() else s.verified_at end
  where s.test_status = 'sending' and s.test_claim_hash = v_hash
  returning s.tenant_id, p_sent and s.version = p_version into v_tenant, v_verified;
  v_found := found;
  if v_found and v_verified then
    insert into platform.audit_events (tenant_id, action, entity_type, entity_id, data)
    values (v_tenant, 'platform.email.integration_verified', 'tenant_email_settings', v_tenant::text,
            jsonb_build_object('version', p_version, 'immediate', true));
  end if;
  return coalesce(v_found and v_verified, false);
end
$$;
comment on function private.inline_email_test_finish(bytea, integer, boolean, text) is
  'SECURITY-RELEVANT (WP-ADM-05 follow-up). Records the outcome of a test e-mail claimed by this request (it needs the request''s secret); a sent test verifies the settings it proved (audited). app_server only. Returns true when the settings became verified.';

grant create on schema private to email_guard;
alter function private.inline_email_test_claim(text, bytea) owner to email_guard;
alter function private.inline_email_test_finish(bytea, integer, boolean, text) owner to email_guard;
revoke create on schema private from email_guard;
revoke all on function private.inline_email_test_claim(text, bytea) from public;
revoke all on function private.inline_email_test_finish(bytea, integer, boolean, text) from public;
grant execute on function private.inline_email_test_claim(text, bytea) to authenticated;
grant execute on function private.inline_email_test_finish(bytea, integer, boolean, text) to authenticated;
