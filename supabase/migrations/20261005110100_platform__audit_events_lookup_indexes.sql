-- Lookups on the audit log for the users screens (T-M2-04): last sign-in per member and the recent
-- activity of one person. Without them each lookup scans the tenant's whole audit log, which only grows.

create index audit_events_sign_in_idx on platform.audit_events (tenant_id, actor_user_id, occurred_at desc)
  where action = 'platform.auth.signed_in';

create index audit_events_entity_idx on platform.audit_events (tenant_id, entity_id, occurred_at desc)
  where entity_id is not null;
