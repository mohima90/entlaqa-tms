-- ADR 0001: one schema per module. The `tms` schema for the Jadarat TMS module; its tables arrive with
-- M3 and follow the tenant RLS pattern of ADR 0002 §6 (enforced by supabase/tests/10_catalog.sql).
-- Not exposed through the Data API (ADR 0002 §5).

create schema if not exists tms;

comment on schema tms is 'Jadarat TMS module (ADR 0001). Not exposed through the Data API.';

revoke all on schema tms from public;
grant usage on schema tms to authenticated;

-- Functions are executable by PUBLIC by default: turn that off for everything created in `tms`.
alter default privileges in schema tms revoke execute on functions from public;
