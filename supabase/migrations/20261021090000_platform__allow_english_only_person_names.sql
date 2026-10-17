-- Name fields follow the organization's default language (guided-test feedback #2, PO 17 Oct 2026; FR-IAM-01,
-- FR-ADM-02): with English as the default, a person's English first and family names are required and the
-- Arabic name is optional — so a person may now have no Arabic name at all.
--
-- Expand only (migration conventions §6): the Arabic display name loses NOT NULL, and a new check keeps every
-- person named — the Arabic display name, or a complete English name (first and family name, and the display
-- name the application composes from them). Every existing row has an Arabic display name, so all of them
-- satisfy the check; it is added NOT VALID (no scan under ACCESS EXCLUSIVE) and validated by the follow-up
-- migration 20261021090100. The existing checks on display_name_ar (inline `length(btrim(…)) > 0` and
-- persons_display_name_ar_visible_check) pass for NULL (private.has_visible_text is STRICT), so a GIVEN Arabic
-- name must still be visible text of at most 200 characters.
--
-- Code of the previous release keeps working: it always writes an Arabic name. Readers handle a missing
-- Arabic name by showing the English one (apps/suite lib/users-view localizedName, the e-mail senders).
set local lock_timeout = '5s';

alter table platform.persons alter column display_name_ar drop not null;

alter table platform.persons
  add constraint persons_name_present_check check (
    display_name_ar is not null
    or (display_name_en is not null and first_name_en is not null and family_name_en is not null)) not valid;

comment on constraint persons_name_present_check on platform.persons is
  'Every person has a name: the Arabic display name, or a complete English name (first and family name). FR-IAM-01; PO 17 Oct 2026 (the required name follows the organization''s default language).';
