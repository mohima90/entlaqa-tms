-- Rollback of 20261008090000_platform__message_deliveries.sql.
drop function private.discard_inactive_tenant_delivery(uuid);
drop table platform.message_deliveries;
drop function private.check_message_delivery();
