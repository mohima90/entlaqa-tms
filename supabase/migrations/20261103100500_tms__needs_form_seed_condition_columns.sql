-- The Super Admin console's «Create organization» works on a busy database too (FR-ADM-17, T-M3-10; PO
-- report 26 Oct 2026). Class: T (column privileges of platform_admin_guard on tms.needs_form_fields). PII: none.
--
-- private.platform_create_tenant seeds the new organization's default needs form as platform_admin_guard
-- (migration 20261020180300). Each field it inserts fires private.check_needs_form_field(), whose
-- «fields that depend on this one» check reads needs_form_fields.condition_field_id and condition_value in one
-- IF expression that starts with `tg_op = 'UPDATE' and …`. While PostgreSQL plans that expression with the
-- trigger's values (custom plans) the INSERT folds it to false and the subquery — with its columns — is never
-- checked; once the backend switches to the cached generic plan (plan_cache_mode auto, after five executions
-- on a pooled connection) the subquery stays in the plan and its column privileges are checked: 42501
-- «permission denied for table needs_form_fields», which the console showed as «not found» (production only).
-- platform_admin_guard reads the two columns the guard reads; the rows stay its own read policy's
-- (needs_form_fields_platform_admin_guard_read). Test: supabase/tests/96_platform_admin_generic_plans_app_server.sql.

grant select (condition_field_id, condition_value) on tms.needs_form_fields to platform_admin_guard;
