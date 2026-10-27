-- The default needs form without the «Estimated cost» field (WP-LD-01; PO decision Q1, 27 Oct 2026: a need's
-- plan units — topic, seats, estimated cost — are structured columns of tms.plan_needs, entered on the Add-a-need
-- panel under «More», not a free number field of the form). Class: T. PII: none.
--
--   private.seed_needs_form   the full default form now seeds nine fields (topic*, description, category,
--                             preferred delivery type, people*, priority, reason type, reason, preferred quarter);
--                             text as in modules/tms needs-forms default-form.ts (drift test).
--   Existing default forms    the seeded «Estimated cost» number field (exact seed labels, no system key) is
--                             removed from forms that are NOT locked — a form a launched cycle uses keeps it, as
--                             the lock promises (production holds test organizations only, PO 15 Oct 2026).
-- Expand-first: no table changes; the application never relied on that field.

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
       {"value": "q4", "label_en": "Fourth quarter", "label_ar": "الربع الرابع"}]'::jsonb);
  return v_form;
end
$$;

-- The seeded field, where the form is not locked (the field guard refuses changes of a locked form).
delete from tms.needs_form_fields x
using tms.needs_forms f
where f.tenant_id = x.tenant_id and f.id = x.form_id and f.locked_at is null
  and x.system_key is null and x.field_type = 'number'
  and x.label_en = 'Estimated cost' and x.label_ar = 'التكلفة التقديرية';
