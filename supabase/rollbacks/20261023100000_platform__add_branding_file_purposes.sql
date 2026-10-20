-- Rollback of 20261023100000_platform__add_branding_file_purposes.sql (fails while files of these purposes exist).
delete from platform.file_purposes
where purpose in ('platform.brand_logo', 'platform.brand_favicon', 'platform.brand_sign_in_image');
