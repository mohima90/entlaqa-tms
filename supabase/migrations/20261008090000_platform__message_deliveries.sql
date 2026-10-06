-- Outbound message delivery log (ADR 0008 §1, §7; T-M2-06b; BR-NTF-2): one row per message and channel
-- attempt plan. A notifications job (system claims) queues an e-mail with its rendered content; the send
-- job claims it, calls the provider with the row id as idempotency key, and records the outcome.
-- Content and the plain address exist only while the message waits to be sent: once it is sent,
-- failed or suppressed they are removed and the row keeps the template, language, masked address,
-- provider id and status (12-month retention: housekeeping job, later).
-- Written and read by background jobs only (system claims under app_worker): user requests never
-- touch it. An admin delivery-log screen (later) gets its own column-limited read path.
-- ADR 0002 §6 pattern. Class: T. PII: destination and content until the final status, masked address.

create table platform.message_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  channel text not null default 'email',
  template text not null,
  template_version smallint not null,
  locale text not null,
  recipient_person_id uuid,
  destination text,
  destination_masked text not null,
  subject text,
  html_body text,
  text_body text,
  status text not null default 'queued',
  attempts smallint not null default 0,
  provider text,
  provider_message_id text,
  error_code text,
  -- The domain event the message answers (tracing; ADR 0004).
  source_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, recipient_person_id) references platform.persons (tenant_id, id),
  constraint message_deliveries_channel_check check (channel = 'email'),
  constraint message_deliveries_template_check
    check (template ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' and char_length(template) <= 100),
  constraint message_deliveries_version_check check (template_version between 1 and 999),
  constraint message_deliveries_locale_check check (locale in ('ar', 'en')),
  constraint message_deliveries_destination_check
    check (destination is null or (char_length(destination) <= 320 and destination ~ '^[^@\s]+@[^@\s]+$')),
  constraint message_deliveries_masked_check check (char_length(destination_masked) between 3 and 320),
  constraint message_deliveries_subject_check check (subject is null or char_length(subject) <= 300),
  constraint message_deliveries_body_check
    check ((html_body is null or char_length(html_body) <= 200000) and (text_body is null or char_length(text_body) <= 100000)),
  constraint message_deliveries_status_check check (status in ('queued', 'sending', 'sent', 'failed', 'suppressed')),
  constraint message_deliveries_attempts_check check (attempts between 0 and 100),
  constraint message_deliveries_provider_check check (provider is null or provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  constraint message_deliveries_provider_id_check check (provider_message_id is null or char_length(provider_message_id) <= 300),
  constraint message_deliveries_error_check check (error_code is null or error_code ~ '^[A-Z0-9_]{2,64}$'),
  -- Waiting messages carry everything needed to send; finished ones carry none of it.
  constraint message_deliveries_content_check check (
    (status in ('queued', 'sending') and destination is not null and subject is not null
       and html_body is not null and text_body is not null)
    or (status in ('sent', 'failed', 'suppressed') and destination is null and subject is null
       and html_body is null and text_body is null)),
  constraint message_deliveries_sent_check
    check ((status = 'sent') = (sent_at is not null) and (status <> 'sent' or provider is not null))
);
comment on table platform.message_deliveries is
  'Outbound message deliveries (ADR 0008 §7, BR-NTF-2): written and read by jobs only; content removed once final. Owner: platform. Class: T.';

create index message_deliveries_waiting_idx on platform.message_deliveries (tenant_id, created_at)
  where status in ('queued', 'sending');
create index message_deliveries_recipient_idx on platform.message_deliveries (tenant_id, recipient_person_id, created_at)
  where recipient_person_id is not null;

-- Lifecycle: inserted as queued; queued ⇄ sending (claim; back to queued after a temporary failure);
-- queued/sending → sent | failed | suppressed (final, never changes again). What the message is, for
-- whom and why never changes after insert.
create or replace function private.check_message_delivery()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'queued' or new.attempts <> 0 or new.provider is not null or new.provider_message_id is not null
       or new.error_code is not null or new.sent_at is not null then
      raise exception 'a delivery starts queued, with no attempts or outcome' using errcode = 'check_violation';
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if old.status in ('sent', 'failed', 'suppressed') then
    raise exception 'a finished delivery cannot change' using errcode = 'check_violation';
  end if;
  -- The id is the provider's idempotency key: it never changes either.
  if (new.id, new.tenant_id, new.channel, new.template, new.template_version, new.locale, new.destination_masked, new.created_at)
       is distinct from (old.id, old.tenant_id, old.channel, old.template, old.template_version, old.locale, old.destination_masked, old.created_at)
     or new.recipient_person_id is distinct from old.recipient_person_id
     or new.source_event_id is distinct from old.source_event_id
     or (new.status in ('queued', 'sending')
         and (new.destination, new.subject, new.html_body, new.text_body)
             is distinct from (old.destination, old.subject, old.html_body, old.text_body)) then
    raise exception 'what a delivery sends and to whom cannot change' using errcode = 'check_violation';
  end if;
  if new.attempts < old.attempts then
    raise exception 'delivery attempts only grow' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function private.check_message_delivery() from public;

create trigger message_deliveries_check before insert or update on platform.message_deliveries
  for each row execute function private.check_message_delivery();

alter table platform.message_deliveries enable row level security;
alter table platform.message_deliveries force row level security;

create policy tenant_isolation on platform.message_deliveries
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Only jobs (system claims under app_worker) queue, claim and finish deliveries.
create policy message_deliveries_jobs on platform.message_deliveries for all to authenticated
  using ((select private.request_claims() ->> 'role') = 'system')
  with check ((select private.request_claims() ->> 'role') = 'system');

revoke all on platform.message_deliveries from public, anon;
grant select, insert, update on platform.message_deliveries to authenticated;

-- A suspended or closed organization's waiting messages: its tenant RLS no longer lets any job reach
-- them (current_tenant_id() is NULL), yet their content and address must not outlive the message
-- (ADR 0008 §7). The send job of such a delivery discards it through this function instead: content
-- removed, recorded as suppressed (TENANT_INACTIVE). It reads nothing back and touches one waiting row of
-- the claimed tenant only, and only while that tenant is inactive (active ones finish through RLS).
-- SECURITY-RELEVANT. SECURITY DEFINER owned by tenant_guard (no BYPASSRLS), which may see the id, tenant
-- and status of waiting deliveries and turn them into suppressed ones — nothing else (grants + policies
-- below). System claims under app_worker only.
create or replace function private.discard_inactive_tenant_delivery(p_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_tenant uuid;
begin
  if session_user <> 'app_worker' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'system'
     or coalesce(btrim(v_claims ->> 'job_id'), '') = '' then
    return false;
  end if;
  v_tenant := private.try_uuid(v_claims ->> 'tenant_id');
  if v_tenant is null
     or exists (select 1 from platform.tenants t where t.id = v_tenant and t.status in ('active', 'trial')) then
    return false;
  end if;
  update platform.message_deliveries d
  set status = 'suppressed', error_code = 'TENANT_INACTIVE',
      destination = null, subject = null, html_body = null, text_body = null
  where d.id = p_id and d.tenant_id = v_tenant and d.status in ('queued', 'sending');
  return found;
end
$$;

comment on function private.discard_inactive_tenant_delivery(uuid) is
  'SECURITY-RELEVANT (ADR 0008 §7). Job of a suspended/closed organization: removes one waiting delivery''s content (suppressed, TENANT_INACTIVE).';

-- (The UPDATE needs read access to the old and the new row; the column grants keep content unreadable.)
create policy message_deliveries_guard_read on platform.message_deliveries for select to tenant_guard
  using (true);
create policy message_deliveries_guard_discard on platform.message_deliveries for update to tenant_guard
  using (status in ('queued', 'sending'))
  with check (status = 'suppressed' and error_code = 'TENANT_INACTIVE');
grant select (id, tenant_id, status) on platform.message_deliveries to tenant_guard;
grant update (status, error_code, destination, subject, html_body, text_body) on platform.message_deliveries to tenant_guard;

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to tenant_guard;
alter function private.discard_inactive_tenant_delivery(uuid) owner to tenant_guard;
revoke create on schema private from tenant_guard;

revoke all on function private.discard_inactive_tenant_delivery(uuid) from public;
grant execute on function private.discard_inactive_tenant_delivery(uuid) to authenticated;
