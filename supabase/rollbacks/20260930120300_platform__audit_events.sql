-- Rollback of 20260930120300_platform__audit_events.sql. Irreversible for DATA: the audit trail is
-- lost — in production restore from backup instead (FR-AUD-01). Schema-wise the pair is consistent.
drop table platform.audit_events;
drop function private.prevent_update_delete();
