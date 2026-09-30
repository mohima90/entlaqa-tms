-- Rollback of 20260930120000_platform__roles_and_schemas.sql.
-- Drops the schemas (they must be empty: roll back later migrations first). Login roles app_server,
-- app_worker and tenant_guard and their memberships are CLUSTER-level objects that other databases of
-- the same cluster may use; they are intentionally left in place (the up migration is idempotent).
do $$
begin
  execute format('grant temporary on database %I to public', current_database());
end
$$;
alter default privileges in schema private grant execute on functions to public;
alter default privileges in schema platform grant execute on functions to public;
drop schema private;
drop schema platform;
