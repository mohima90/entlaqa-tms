-- Rollback of 20261022100000_platform__add_message_deliveries_sender.sql.
alter table platform.message_deliveries drop column if exists sender;
