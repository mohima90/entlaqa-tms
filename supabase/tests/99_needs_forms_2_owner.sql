-- db-test: run-as=owner
-- Default needs forms (T-M3-10; migrations 20261020180300/180400): every organization has one — the fixture
-- tenants (created after the migrations, by the trigger), a new organization created by provisioning (the
-- owner) and one created the way the platform console does it (as platform_admin_guard, which may only seed:
-- no update or delete of needs forms). The seeded content matches the business flow (one repeatable «Training
-- needs» section; topic and people required system fields; eight more fields).
\set ON_ERROR_STOP on

do $$
begin
  perform tests.assert_eq((select count(*) from platform.tenants t
                           where (select count(*) from tms.needs_forms f where f.tenant_id = t.id and f.is_default) <> 1),
    0::bigint, 'every organization has exactly one default needs form');
  perform tests.assert_eq(
    (select string_agg(coalesce(x.system_key, '-') || ':' || x.field_type || ':' || x.is_required || ':' || x.label_en, ', ' order by x.sort_order)
     from tms.needs_form_fields x join tms.needs_forms f on f.id = x.form_id
     where f.tenant_id = 'b0000000-0000-4000-8000-000000000001' and f.is_default),
    'training_topic:text:true:Training topic, -:textarea:false:Description, -:select:false:Category, '
    || '-:select:false:Preferred delivery type, people:people:true:People, -:select:false:Priority, '
    || '-:select:false:Reason type, -:textarea:false:Reason, -:select:false:Preferred quarter, '
    || '-:number:false:Estimated cost',
    'the default form''s fields, in order');
  perform tests.assert_eq(
    (select row(s.name_en, s.name_ar, s.is_repeatable, s.min_entries, s.max_entries)::text
     from tms.needs_form_sections s join tms.needs_forms f on f.id = s.form_id
     where f.tenant_id = 'b0000000-0000-4000-8000-000000000001' and f.is_default),
    row('Training needs', 'الاحتياجات التدريبية', true, 1::smallint, 50::smallint)::text,
    'one repeatable «Training needs» section');
  perform tests.assert_eq(
    (select string_agg(o ->> 'value', ',') from tms.needs_form_fields x join tms.needs_forms f on f.id = x.form_id,
            jsonb_array_elements(x.options) o
     where f.tenant_id = 'b0000000-0000-4000-8000-000000000001' and f.is_default and x.label_en = 'Priority'),
    'critical,high,medium,low', 'priority values');
end $$;

-- Provisioning (the owner): a new organization gets its default form in the same transaction.
begin;
insert into platform.tenants (id, slug, name_ar, name_en, status)
values ('e9000000-0000-4000-8000-000000000001', 'needs-new', 'منشأة جديدة', 'New organization', 'active');
do $$
begin
  perform tests.assert_eq((select count(*) from tms.needs_form_fields x join tms.needs_forms f on f.id = x.form_id
                           where f.tenant_id = 'e9000000-0000-4000-8000-000000000001' and f.is_default),
    10::bigint, 'provisioning: the default form with its ten fields');
end $$;
set constraints all immediate;
rollback;

-- The platform console (its definer functions run as platform_admin_guard): seeding works, nothing else.
begin;
set local role platform_admin_guard;
insert into platform.tenants (slug, name_ar, name_en, status)
values ('needs-console', 'منشأة المنصة', null, 'active');
set constraints all immediate;
do $$
declare
  v_tenant uuid := (select id from platform.tenants where slug = 'needs-console');
begin
  perform tests.assert_eq((select count(*) from tms.needs_forms f where f.tenant_id = v_tenant and f.is_default),
    1::bigint, 'console: the new organization has its default form');
  perform tests.assert_privilege_denied(format($q$update tms.needs_forms set name_en = 'x' where tenant_id = %L$q$, v_tenant),
    'console: needs forms are not updated');
  perform tests.assert_privilege_denied(format($q$delete from tms.needs_form_fields where tenant_id = %L$q$, v_tenant),
    'console: needs-form fields are not deleted');
  perform tests.assert_rls_violation(format($q$insert into tms.needs_forms (tenant_id, name_en, name_ar, is_default) values (%L, 'Second', 'ثان', false)$q$, v_tenant),
    'console: only a default form is seeded');
  -- 20261020210200: sections and fields only into the form it has just created, never another organization's.
  perform tests.assert_rls_violation($q$insert into tms.needs_form_sections (tenant_id, form_id, name_en, name_ar) select f.tenant_id, f.id, 'Extra', 'إضافي' from tms.needs_forms f where f.tenant_id = 'a0000000-0000-4000-8000-000000000001' and f.is_default$q$,
    'console: no section is added to an existing organization''s form');
  perform tests.assert_rls_violation($q$insert into tms.needs_form_fields (tenant_id, form_id, section_id, field_type, label_en, label_ar) select s.tenant_id, s.form_id, s.id, 'text', 'Extra', 'إضافي' from tms.needs_form_sections s join tms.needs_forms f on f.tenant_id = s.tenant_id and f.id = s.form_id where f.tenant_id = 'a0000000-0000-4000-8000-000000000001' and f.is_default limit 1$q$,
    'console: nor a field');
end $$;
rollback;

-- Platform operations follow the structure rules too: a locked form stays frozen (support duplicates it).
begin;
do $$
declare
  v_form uuid := (select id from tms.needs_forms where tenant_id = 'b0000000-0000-4000-8000-000000000001' and is_default);
begin
  update tms.needs_forms set locked_at = now() where id = v_form;
  perform tests.assert_fails(format($q$update tms.needs_form_fields set label_en = 'x' where form_id = %L$q$, v_form),
    array['JN001'], 'platform operations: no field of a locked form changes');
  perform tests.assert_fails(format($q$delete from tms.needs_forms where id = %L$q$, v_form),
    array['JN003'], 'platform operations: the default form is not deleted');
end $$;
rollback;

\echo '99_needs_forms_2_owner: ok'
