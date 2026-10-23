-- Rollback of 20261026100200_private__sign_in_codes.sql.
drop function private.retry_sign_in_code_request(uuid);
drop function private.sign_in_code_dead_end(uuid);
drop function private.issue_sign_in_code(uuid, uuid, uuid, text, text);
drop function private.claim_sign_in_code_request();
drop function private.account_needs_platform_sender(uuid);
drop function private.remembered_browser_for_email(text, bytea);
drop function private.take_remembered_sign_in(uuid, text, bytea, bytea);
revoke execute on function private.platform_admin_is_active(uuid) from account_mail_guard;
drop function private.verify_sign_in_code(uuid, text, text);
drop function private.request_sign_in_code(text, bytea);
drop function private.sign_in_code_hmac(uuid, text);
drop table private.sign_in_codes;
drop table private.sign_in_code_secret;
