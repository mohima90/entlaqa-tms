-- The organization's display names (FR-ADM-02; T-M2-22; approved screen «بيانات المنشأة»): the
-- Organization Admin changes name_ar / name_en from the profile page. Until now platform.tenants was
-- read-only for users (provisioned by platform operations only); this opens exactly these two columns, to
-- the same writer as platform.tenant_settings (private.actor_may_manage_tenant: Organization Admin at
-- AAL2 with a recent code). Slug, status, edition, mode and data residency stay platform-only.
-- The action normalizes the names (NFC), trims them and limits them to 80 characters (the screen); the
-- database keeps the provisioning limit (200, scripts/sql/provision-tenant.sql), refuses a blank English
-- name (empty means none: null) and bidirectional override/isolate marks (U+202A–U+202E, U+2066–U+2069),
-- which could reorder how a name reads next to other text (review L3; joiners ZWNJ/ZWJ stay allowed).
-- Who changed them and when is recorded on platform.tenant_settings (the same save) and in the audit log.
-- The checks are validated against the existing rows as they are added (a handful of organizations; the
-- deploy wraps each migration in a transaction, so the lock timeout is local to it — review L5).
set local lock_timeout = '5s';

alter table platform.tenants
  add constraint tenants_name_ar_length_check check (char_length(name_ar) <= 200),
  add constraint tenants_name_en_check
    check (name_en is null or (length(btrim(name_en)) > 0 and char_length(name_en) <= 200)),
  add constraint tenants_names_bidi_check
    check (name_ar !~ '[‪-‮⁦-⁩]' and coalesce(name_en, '') !~ '[‪-‮⁦-⁩]');

create policy tenants_update on platform.tenants for update to authenticated
  using (private.actor_may_manage_tenant(id))
  with check (private.actor_may_manage_tenant(id));

grant update (name_ar, name_en) on platform.tenants to authenticated;
