-- Every organization starts with a ready default needs form (T-M3-10; FR-PLN-03; PO, 17 Oct 2026 — business
-- flow EP-PLN §12 (1)), like Kawadir's seeded application form. Class: T. PII: none.
--
--   private.seed_needs_form(tenant, name_en, name_ar, is_default, full)
--       full = true: the default form — one repeatable section «Training needs» / «الاحتياجات التدريبية»
--       (1–50 entries) with the training topic*, description, category, preferred delivery type, people*,
--       priority, reason type, reason, preferred quarter and estimated cost (* = system field, required);
--       full = false: a new, blank form — the same section with the two system fields only (Kawadir: «fresh
--       forms start minimal; duplicate copies a full form»).
--       SECURITY INVOKER: called by platform operations (the trigger below, the backfill migration) and by
--       the L&D Manager's «Create form» (the guards apply: designer only, own organization).
--   trigger tenants_seed_needs_form   after a new organization is created — by the provisioning script, the
--       platform console (private.platform_create_tenant, as platform_admin_guard) or the self-hosted
--       stack's seeds — its default form is seeded in the same transaction.
-- The English and Arabic texts are those of modules/tms needs-forms default-form.ts (drift test).
-- platform_admin_guard (the console's tenant creation) gets exactly what seeding needs: inserting the rows
-- and reading what the guards read (lock state, system fields, defaults) — no update, no delete.
-- Suite note (ADR 0001): the trigger sits on platform.tenants but belongs to the TMS module, which owns the
-- seeded rows; a platform `tenant.created` event replaces it when module provisioning moves to events.

create or replace function private.seed_needs_form(p_tenant_id uuid, p_name_en text, p_name_ar text,
                                                   p_is_default boolean, p_full boolean)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_form uuid := gen_random_uuid();
  v_section uuid := gen_random_uuid();
begin
  insert into tms.needs_forms (id, tenant_id, name_en, name_ar, is_default, is_active)
  values (v_form, p_tenant_id, p_name_en, p_name_ar, p_is_default, true);
  insert into tms.needs_form_sections (id, tenant_id, form_id, name_en, name_ar, description_en, description_ar,
                                       is_repeatable, min_entries, max_entries, is_visible, sort_order)
  values (v_section, p_tenant_id, v_form, 'Training needs', 'الاحتياجات التدريبية',
          'Add one entry for each training need of your team.', 'أضف بندًا لكل احتياج تدريبي لفريقك.',
          true, 1, 50, true, 1);
  insert into tms.needs_form_fields (tenant_id, form_id, section_id, system_key, field_type, label_en, label_ar,
                                     placeholder_en, placeholder_ar, is_required, is_visible, sort_order, options,
                                     people_mode)
  values
    (p_tenant_id, v_form, v_section, 'training_topic', 'text', 'Training topic', 'موضوع التدريب',
     'For example: Project management basics', 'مثال: أساسيات إدارة المشاريع', true, true, 1, null, null),
    (p_tenant_id, v_form, v_section, 'people', 'people', 'People', 'المشاركون',
     null, null, true, true, case when p_full then 5 else 2 end, null, 'count_or_employees');
  if not p_full then
    return v_form;
  end if;
  insert into tms.needs_form_fields (tenant_id, form_id, section_id, field_type, label_en, label_ar,
                                     placeholder_en, placeholder_ar, is_required, is_visible, sort_order, options)
  values
    (p_tenant_id, v_form, v_section, 'textarea', 'Description', 'الوصف',
     'What should the training cover?', 'ما الذي ينبغي أن يغطيه التدريب؟', false, true, 2, null),
    (p_tenant_id, v_form, v_section, 'select', 'Category', 'التصنيف', null, null, false, true, 3,
     '[{"value": "technical", "label_en": "Technical", "label_ar": "تقني"},
       {"value": "leadership", "label_en": "Leadership and management", "label_ar": "القيادة والإدارة"},
       {"value": "soft_skills", "label_en": "Personal skills", "label_ar": "المهارات الشخصية"},
       {"value": "digital", "label_en": "Digital skills", "label_ar": "المهارات الرقمية"},
       {"value": "compliance", "label_en": "Compliance and regulations", "label_ar": "الامتثال واللوائح"},
       {"value": "health_safety", "label_en": "Health and safety", "label_ar": "الصحة والسلامة"}]'::jsonb),
    (p_tenant_id, v_form, v_section, 'select', 'Preferred delivery type', 'نمط التقديم المفضّل', null, null, false,
     true, 4,
     '[{"value": "classroom", "label_en": "Classroom", "label_ar": "حضوري"},
       {"value": "virtual", "label_en": "Virtual", "label_ar": "افتراضي"},
       {"value": "blended", "label_en": "Blended", "label_ar": "مدمج"},
       {"value": "on_the_job", "label_en": "On the job", "label_ar": "على رأس العمل"}]'::jsonb),
    (p_tenant_id, v_form, v_section, 'select', 'Priority', 'الأولوية', null, null, false, true, 6,
     '[{"value": "critical", "label_en": "Critical", "label_ar": "حرجة"},
       {"value": "high", "label_en": "High", "label_ar": "عالية"},
       {"value": "medium", "label_en": "Medium", "label_ar": "متوسطة"},
       {"value": "low", "label_en": "Low", "label_ar": "منخفضة"}]'::jsonb),
    (p_tenant_id, v_form, v_section, 'select', 'Reason type', 'نوع السبب', null, null, false, true, 7,
     '[{"value": "role_requirement", "label_en": "Role requirement", "label_ar": "متطلب وظيفي"},
       {"value": "compliance", "label_en": "Compliance or mandatory", "label_ar": "امتثال أو تدريب إلزامي"},
       {"value": "performance", "label_en": "Performance improvement", "label_ar": "تحسين الأداء"},
       {"value": "development", "label_en": "Career development", "label_ar": "تطوير مهني"},
       {"value": "new_project", "label_en": "New project", "label_ar": "مشروع جديد"}]'::jsonb),
    (p_tenant_id, v_form, v_section, 'textarea', 'Reason', 'السبب',
     'Why does your team need this training?', 'لماذا يحتاج فريقك إلى هذا التدريب؟', false, true, 8, null),
    (p_tenant_id, v_form, v_section, 'select', 'Preferred quarter', 'الربع المفضّل', null, null, false, true, 9,
     '[{"value": "q1", "label_en": "First quarter", "label_ar": "الربع الأول"},
       {"value": "q2", "label_en": "Second quarter", "label_ar": "الربع الثاني"},
       {"value": "q3", "label_en": "Third quarter", "label_ar": "الربع الثالث"},
       {"value": "q4", "label_en": "Fourth quarter", "label_ar": "الربع الرابع"}]'::jsonb),
    (p_tenant_id, v_form, v_section, 'number', 'Estimated cost', 'التكلفة التقديرية', null, null, false, true, 10,
     null);
  return v_form;
end
$$;

comment on function private.seed_needs_form(uuid, text, text, boolean, boolean) is
  'Creates a needs form with the «Training needs» section (T-M3-10): the default form (full) or a blank one. Invoker: the guards apply.';

revoke all on function private.seed_needs_form(uuid, text, text, boolean, boolean) from public;
grant execute on function private.seed_needs_form(uuid, text, text, boolean, boolean)
  to authenticated, platform_admin_guard;

-- A new organization's default form (idempotent: nothing when it already has forms).
create or replace function private.seed_tenant_needs_form()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from tms.needs_forms f where f.tenant_id = new.id) then
    perform private.seed_needs_form(new.id, 'Default needs form', 'نموذج الاحتياجات الافتراضي', true, true);
  end if;
  return new;
end
$$;

comment on function private.seed_tenant_needs_form() is
  'Seeds the default needs form of a new organization (T-M3-10).';

revoke all on function private.seed_tenant_needs_form() from public;

create trigger tenants_seed_needs_form after insert on platform.tenants
  for each row execute function private.seed_tenant_needs_form();

-- The platform console creates organizations as platform_admin_guard (20261018100000): seeding only.
grant usage on schema tms to platform_admin_guard;
grant execute on function private.needs_form_options_valid(text, jsonb), private.needs_form_locked(uuid, uuid),
                          private.check_needs_form_actor(uuid)
  to platform_admin_guard;

create policy needs_forms_platform_admin_guard_read on tms.needs_forms for select to platform_admin_guard
  using (true);
create policy needs_forms_platform_admin_guard_insert on tms.needs_forms for insert to platform_admin_guard
  with check (is_default and locked_at is null);
grant select (id, tenant_id, is_default, locked_at) on tms.needs_forms to platform_admin_guard;
grant insert (id, tenant_id, name_en, name_ar, is_default, is_active) on tms.needs_forms to platform_admin_guard;

create policy needs_form_sections_platform_admin_guard_read on tms.needs_form_sections for select
  to platform_admin_guard using (true);
create policy needs_form_sections_platform_admin_guard_insert on tms.needs_form_sections for insert
  to platform_admin_guard with check (true);
grant select (id, tenant_id, form_id) on tms.needs_form_sections to platform_admin_guard;
grant insert (id, tenant_id, form_id, name_en, name_ar, description_en, description_ar, is_repeatable, min_entries,
              max_entries, is_visible, sort_order)
  on tms.needs_form_sections to platform_admin_guard;

create policy needs_form_fields_platform_admin_guard_read on tms.needs_form_fields for select
  to platform_admin_guard using (true);
create policy needs_form_fields_platform_admin_guard_insert on tms.needs_form_fields for insert
  to platform_admin_guard with check (true);
grant select (id, tenant_id, form_id, section_id, system_key) on tms.needs_form_fields to platform_admin_guard;
grant insert (tenant_id, form_id, section_id, system_key, field_type, label_en, label_ar, placeholder_en,
              placeholder_ar, is_required, is_visible, sort_order, options, people_mode)
  on tms.needs_form_fields to platform_admin_guard;
