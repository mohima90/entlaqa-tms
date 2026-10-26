-- Rollback of 20261103100500_tms__needs_form_seed_condition_columns.sql.

revoke select (condition_field_id, condition_value) on tms.needs_form_fields from platform_admin_guard;
