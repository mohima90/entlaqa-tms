-- db-test: run-as=storage
-- Storage's read policy for branding images without a malware scan (WP-ADM-02; PO decision 20 Oct 2026;
-- private.can_read_object, 20261023100600): the uploader reads back their OWN upload of a purpose without a
-- scan while it waits to be accepted, for a day after the upload — the web app checks and copies it with
-- the uploader's session at save time. Nobody else, nothing older, never a scanned purpose's upload before
-- its scan, never a clean file without a grant. Connected as Supabase Storage's login role (fixtures: 00,
-- 65, 99_branding_0).
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'supabase_storage_admin', 'must run connected as supabase_storage_admin'); end $$;

begin;
set local role authenticated;
do $$
declare
  v_key constant text := 'a0000000-0000-4000-8000-000000000001/platform/tenant_branding/a0000000-0000-4000-8000-000000000001/';
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
begin
  -- uA, the uploader.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', v_a));
  perform tests.assert(private.can_read_object('images', v_key || 'f0a20000-0000-4000-8000-000000000005'),
    'the uploader reads back their own branding upload (not scanned, waiting to be accepted)');
  perform tests.assert(not private.can_read_object('imports', v_key || 'f0a20000-0000-4000-8000-000000000005'),
    'only in its own bucket');
  perform tests.assert(not private.can_read_object('images', v_key || 'f0a20000-0000-4000-8000-000000000007'),
    'not an upload older than a day');
  perform tests.assert(not private.can_read_object('images', v_key || 'f0a20000-0000-4000-8000-000000000006'),
    'not a rejected upload');
  perform tests.assert(not private.can_read_object('images', v_key || 'f0a20000-0000-4000-8000-000000000002'),
    'not a clean branding image without a download grant');
  perform tests.assert(not private.can_read_object('images',
      'a0000000-0000-4000-8000-000000000001/platform/person/a1000000-0000-4000-8000-0000000000a1/f0a20000-0000-4000-8000-000000000008'),
    'never a scanned purpose''s upload before its scan (a profile photo)');
  -- uA2, the other Organization Admin of A: not their upload.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91', v_a));
  perform tests.assert(not private.can_read_object('images', v_key || 'f0a20000-0000-4000-8000-000000000005'),
    'another admin of the organization cannot read it');
  -- uB in B: another tenant (the key's tenant is not the caller's).
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
                                             'b0000000-0000-4000-8000-000000000001'));
  perform tests.assert(not private.can_read_object('images', v_key || 'f0a20000-0000-4000-8000-000000000005'),
    'another organization cannot read it');
  -- uA with an unknown session: no tenant, nothing.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', gen_random_uuid(), v_a));
  perform tests.assert(not private.can_read_object('images', v_key || 'f0a20000-0000-4000-8000-000000000005'),
    'an unknown session reads nothing');
end $$;
rollback;

\echo '99_branding_7_without_scan_storage: ok'
