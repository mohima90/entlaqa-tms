-- Rollback of 20261007090000_platform__jobs_and_event_outbox.sql. The cluster-wide role app_queue is kept
-- (other databases may use it); its privileges in this database are removed.
drop trigger event_outbox_notify on platform.event_outbox;
drop function private.notify_event_dispatcher();
drop table platform.event_inbox;
drop table platform.event_outbox;
drop function private.stamp_event_actor();
drop schema if exists graphile_worker cascade;
revoke usage on schema platform from app_queue;
revoke app_queue from current_user;
