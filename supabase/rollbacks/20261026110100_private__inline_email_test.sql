-- Rollback of 20261026110100_private__inline_email_test.sql: test e-mails are claimed by the worker only again.
drop function if exists private.inline_email_test_finish(bytea, integer, boolean, text);
drop function if exists private.inline_email_test_claim(text, bytea);
alter table private.tenant_email_settings
  drop constraint tenant_email_settings_claim_hash_check,
  drop column test_claim_hash;
alter table private.platform_email_settings
  drop constraint platform_email_settings_claim_hash_check,
  drop column test_claim_hash;
