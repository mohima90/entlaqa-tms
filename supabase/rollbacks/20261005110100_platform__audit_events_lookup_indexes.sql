-- Rollback of 20261005110100_platform__audit_events_lookup_indexes.sql.
drop index platform.audit_events_entity_idx;
drop index platform.audit_events_sign_in_idx;
