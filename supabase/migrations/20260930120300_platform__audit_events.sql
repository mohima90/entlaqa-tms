-- Append-only audit log (FR-AUD-01). Class: T [ao]. Tenant-scoped; written inside the same transaction
-- as the change (defineAction). No UPDATE/DELETE grants and a trigger that raises on UPDATE/DELETE for
-- every role; retention/erasure (FR-AUD-02/03) will be a reviewed platform operation (M2).
-- Minimal walking-skeleton form: M2 expands it (actor_type, before/after, monthly partitions — data model §2.5).
-- PII: ids only.

create or replace function private.prevent_update_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'table %.% is append-only', tg_table_schema, tg_table_name
    using errcode = 'insufficient_privilege';
end
$$;

revoke all on function private.prevent_update_delete() from public;

create table platform.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  occurred_at timestamptz not null default now(),
  actor_user_id uuid,
  actor_person_id uuid,
  impersonator_user_id uuid,
  action text not null check (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$'),
  entity_type text,
  entity_id text,
  request_id text,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  unique (tenant_id, id)
);
comment on table platform.audit_events is 'Append-only audit trail. No personal data beyond ids; never secrets.';
-- No FK to persons: audit records must outlive the records they describe.
create index audit_events_tenant_occurred_idx on platform.audit_events (tenant_id, occurred_at desc);

create trigger audit_events_append_only before update or delete on platform.audit_events
  for each row execute function private.prevent_update_delete();

alter table platform.audit_events enable row level security;
alter table platform.audit_events force row level security;

create policy tenant_isolation on platform.audit_events
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Reading the audit log requires platform.audit.read (enforced server-side).
create policy audit_events_read on platform.audit_events for select to authenticated using (true);
-- The actor cannot be forged: user and person must be the verified subject of request.jwt.claims (both
-- NULL for system actors, whose claims carry neither). Impersonation (ADR 0003 §6) is not implemented:
-- until support grants add a validated `act_as`/`actor` claim kind, impersonator_user_id must be NULL.
create policy audit_events_insert on platform.audit_events for insert to authenticated
  with check (
    actor_user_id is not distinct from (select private.request_user_id())
    and actor_person_id is not distinct from (select private.try_uuid(private.request_claims() ->> 'person_id'))
    and impersonator_user_id is null
  );

revoke all on platform.audit_events from public, anon;
grant select, insert on platform.audit_events to authenticated;
