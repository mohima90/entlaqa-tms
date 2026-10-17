-- Data backfill (T-M3-10; separate from the schema change, conventions §2): every existing organization gets
-- its default needs form, as new ones do from the trigger of 20261020180300. Idempotent (organizations that
-- already have a form are skipped). Runs without user claims (platform operation).
do $$
declare
  r record;
begin
  for r in select t.id from platform.tenants t
           where not exists (select 1 from tms.needs_forms f where f.tenant_id = t.id)
           order by t.created_at, t.id loop
    perform private.seed_needs_form(r.id, 'Default needs form', 'نموذج الاحتياجات الافتراضي', true, true);
  end loop;
end
$$;
