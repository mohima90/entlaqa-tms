-- Rollback of 20261013090000_private__rate_limiter.sql. The cluster-wide role rate_limit_guard is kept
-- (other databases may use it); its privileges in this database are removed.
-- Roll the web app back first: without these functions every limited flow fails closed (sign-in answers
-- a generic error; docs/engineering/sign-in-protection.md).
drop function private.rate_limit_clear(text, bytea);
drop function private.rate_limit_peek(text, bytea, integer);
drop function private.rate_limit_hit(text, bytea, integer, integer);
drop function private.rate_limit_check_call(text, bytea);
drop function private.rate_limit_key(bytea);

drop table private.rate_limit_counters;
drop table private.rate_limit_secret;

revoke usage on schema private from rate_limit_guard;
revoke rate_limit_guard from current_user;
