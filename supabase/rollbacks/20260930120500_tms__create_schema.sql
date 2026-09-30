-- Rollback of 20260930120500_tms__create_schema.sql. The schema must be empty (roll back later tms migrations first).
alter default privileges in schema tms grant execute on functions to public;
drop schema tms;
