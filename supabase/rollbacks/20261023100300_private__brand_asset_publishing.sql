-- Rollback of 20261023100300_private__brand_asset_publishing.sql.
revoke select (slug, name_ar, name_en) on platform.tenants from file_guard;
drop function private.public_tenant_brand(text);
drop function private.public_brand_asset(uuid);
drop function private.publish_brand_asset(uuid, text, bytea);
drop function private.claim_brand_asset_work(integer);
