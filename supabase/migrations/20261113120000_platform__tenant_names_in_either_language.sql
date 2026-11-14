-- An organization is named in the language chosen when it is created; the other language is optional
-- (WP-UX-01 d, T-M3-21; FR-ADM-17, FR-STE-08; PO 12 Nov 2026 — the Kawadir pattern: «the name in the default
-- language is required; the other language is optional»). Until now platform.tenants required the Arabic
-- name and not the English one. The rule the PO approved for people on 17 Oct 2026 (20261021090000) and for
-- planning cycles on 12 Nov 2026 (20261112100100), applied to platform.tenants.
--
-- Expand only (migration conventions §6): name_ar loses NOT NULL (name_en was never required), and a new
-- check keeps every organization named in at least one language. Every existing row has an Arabic name, so
-- all of them satisfy the check; it is added NOT VALID (no scan under ACCESS EXCLUSIVE) and validated by the
-- follow-up migration 20261113120100. The existing checks on each name pass for NULL, so a GIVEN name must
-- still be non-blank, within 200 characters and free of bidirectional override marks (tenants_name_ar_check,
-- tenants_name_ar_length_check, tenants_name_en_check, tenants_names_bidi_check).
--
-- Which language is required is the application's rule (the language chosen in the Super Admin's «Create
-- organization» popup — apps/suite lib/platform-console-input); the database only refuses an organization
-- without any name. Code of the previous release keeps working: it always writes the Arabic name. Readers
-- show the other language when one is missing (platform-db organizationNames; apps/suite localizedName).
-- Provisioning (scripts/sql/provision-tenant.sql) still asks for the Arabic name. PII: none.
set local lock_timeout = '5s';

alter table platform.tenants alter column name_ar drop not null;
alter table platform.tenants
  add constraint tenants_name_present_check check (name_ar is not null or name_en is not null) not valid;
comment on constraint tenants_name_present_check on platform.tenants is
  'An organization has a name in at least one language; the required one is the language chosen when it is created (application rule). FR-ADM-17; PO 12 Nov 2026.';
