-- The Super Admin console's seeding writes only the needs form it has just created (security review, info
-- finding on T-M3-10; migration 20261020180300). Class: T (policies of platform_admin_guard on
-- tms.needs_form_sections and tms.needs_form_fields). PII: none.
--
-- platform_admin_guard (the console's tenant creation, private.platform_create_tenant) could insert sections
-- and fields into ANY organization's form (`with check (true)`; the composite foreign keys only keep a row in
-- its form's organization). Now a section or field it inserts must belong to a default, unlocked form created
-- in the same transaction (created_at = now(), the transaction's start: private.stamp_row) — exactly what
-- private.seed_needs_form does for a new organization. Expand-first: seeding is unchanged.

grant select (created_at) on tms.needs_forms to platform_admin_guard;

drop policy needs_form_sections_platform_admin_guard_insert on tms.needs_form_sections;
create policy needs_form_sections_platform_admin_guard_insert on tms.needs_form_sections for insert
  to platform_admin_guard
  with check (exists (select 1 from tms.needs_forms f
                      where f.tenant_id = needs_form_sections.tenant_id and f.id = needs_form_sections.form_id
                        and f.is_default and f.locked_at is null and f.created_at = now()));

drop policy needs_form_fields_platform_admin_guard_insert on tms.needs_form_fields;
create policy needs_form_fields_platform_admin_guard_insert on tms.needs_form_fields for insert
  to platform_admin_guard
  with check (exists (select 1 from tms.needs_forms f
                      where f.tenant_id = needs_form_fields.tenant_id and f.id = needs_form_fields.form_id
                        and f.is_default and f.locked_at is null and f.created_at = now()));
