# shellcheck shell=bash
# Self-hosted smoke, bulk user import (T-M2-12, FR-IAM-04; approved import screens 1–13). Sourced by
# smoke.sh, which provides compose, q (psql as the migration role), mail_ids and ROOT, has seeded the
# sample people (seed-users.sql) and runs the workers and the malware scanner. Exercises:
#   - the browser journey (apps/suite/e2e/user-import.spec.ts), English and Arabic: the template, the
#     upload straight to Storage with a signed URL, the scan and the reading, the mapping, the review with
#     its list of problems (formula cells written as text), options and confirmation, the run, the error
#     report, the undo; people added without invitations, then invited from the users list;
#   - the database afterwards: the imports' states, the people and invitations they added or removed,
#     nothing added for refused rows; the files kept for the import's retention only;
#   - the audit trail: every step audited (upload, mapping, confirmation, run, downloads, undo, sends) with
#     counts and codes only — no address, name or cell of the file;
#   - the invitations sent from the users list reach Mailpit, as sent deliveries without content;
#   - no address, name, cell or file name of the imports in the containers' logs.
# Usage: import_journey <admin e-mail> <admin password>

import_journey() {
  local email="$1" password="$2"
  echo "smoke: bulk user import (T-M2-12) — upload, review, run, report, undo; add without invitations, then send"
  (cd "$ROOT/apps/suite" && E2E_BASE_URL=http://localhost:3200 SIGNED_IN_E2E_EMAIL="$email" \
    SIGNED_IN_E2E_PASSWORD="$password" pnpm exec playwright test e2e/user-import.spec.ts --project=desktop-chromium)

  # The English import was run, then undone: its person is removed (inactive, marked, invisible to the app)
  # and the invitation revoked — and the address was invited again by hand (a new record, as if never
  # added); the refused rows added nobody.
  [[ "$(q "select string_agg(status, ',' order by created_at) from platform.user_imports where file_name like 'staff-en-%'")" == "undone" ]] ||
    { echo "smoke: import: the English import must be undone" >&2; return 1; }
  [[ "$(q "select count(*) from platform.persons p join platform.invitations i on i.tenant_id = p.tenant_id and i.person_id = p.id
          join platform.user_imports u on u.tenant_id = p.tenant_id and u.id = p.removed_by_import_id
          where p.email like 'import-en-new-%' and p.status = 'inactive' and p.removed_at is not null
            and u.file_name like 'staff-en-%' and i.status = 'revoked' and i.import_id = u.id")" == "1" ]] ||
    { echo "smoke: import: the undo must revoke the invitation and mark the added person removed" >&2; return 1; }
  [[ "$(q "select count(*) from platform.persons p join platform.invitations i on i.tenant_id = p.tenant_id and i.person_id = p.id
          where p.email like 'import-en-new-%' and p.removed_at is null and i.status = 'pending' and i.import_id is null")" == "1" ]] ||
    { echo "smoke: import: the removed person's address must be free for a new invitation by hand" >&2; return 1; }
  [[ "$(q "select count(*) from platform.persons where email like 'import-en-admin-%' or email like 'import-en-twice-%' or email = 'not-an-email'")" == "0" ]] ||
    { echo "smoke: import: a refused row added a person" >&2; return 1; }
  [[ "$(q "select (result_counts ->> 'added') || ',' || (result_counts ->> 'failed') from platform.user_imports where file_name like 'staff-en-%'")" == "1,4" ]] ||
    { echo "smoke: import: unexpected counts of the English import" >&2; return 1; }

  # The Arabic import finished with two people whose invitations were held, then sent from the users list.
  [[ "$(q "select string_agg(status, ',') from platform.user_imports where file_name like 'موظفو-%'")" == "finished" ]] ||
    { echo "smoke: import: the Arabic import must be finished" >&2; return 1; }
  # Sending only schedules them: the worker releases them at the send clock's pace and the mailer counts
  # each send, so wait for both (as for the e-mails below).
  local first second i
  for i in $(seq 1 60); do
    [[ "$(q "select count(*) from platform.invitations i join platform.user_imports u on u.tenant_id = i.tenant_id and u.id = i.import_id
            where u.file_name like 'موظفو-%' and i.email like 'import-ar-%' and i.status = 'pending' and not i.mail_held and i.send_count = 1")" == "2" ]] && break
    [[ $i -eq 60 ]] && { echo "smoke: import: both held invitations must have been sent from the users list" >&2; return 1; }
    sleep 1
  done
  first="$(q "select email from platform.invitations where email like 'import-ar-1-%' order by created_at desc limit 1")"
  second="$(q "select email from platform.invitations where email like 'import-ar-2-%' order by created_at desc limit 1")"
  for i in $(seq 1 60); do
    [[ "$(mail_ids "$first" | wc -l)" -ge 1 && "$(mail_ids "$second" | wc -l)" -ge 1 ]] && break
    [[ $i -eq 60 ]] && { echo "smoke: import: the invitations sent from the users list did not reach Mailpit" >&2; return 1; }
    sleep 1
  done
  # Held invitations are e-mailed only when sent, once each (the row's «إرسال الدعوة», then the banner's
  # «إرسال الدعوات» for the rest).
  [[ "$(mail_ids "$first" | wc -l)" == "1" && "$(mail_ids "$second" | wc -l)" == "1" ]] ||
    { echo "smoke: import: each held invitation must be e-mailed exactly once" >&2; return 1; }
  for i in $(seq 1 30); do
    [[ "$(q "select count(*) from platform.message_deliveries d join platform.invitations v on v.tenant_id = d.tenant_id and v.person_id = d.recipient_person_id
            where v.email like 'import-ar-%' and d.template = 'platform.invitation' and d.status = 'sent'
              and d.destination is null and d.subject is null and d.html_body is null and d.text_body is null")" == "2" ]] && break
    [[ $i -eq 30 ]] && { echo "smoke: import: expected two sent invitation deliveries without content" >&2; return 1; }
    sleep 1
  done

  # Every step audited, with counts and codes only.
  [[ "$(q "select count(distinct action) from platform.audit_events where action in ('platform.user_import.uploaded',
          'platform.user_import.mapped', 'platform.user_import.confirmed', 'platform.user_import.finished',
          'platform.user_import.report_downloaded', 'platform.user_import.undo_requested', 'platform.user_import.undone',
          'platform.invitation.send_requested')")" == "8" ]] ||
    { echo "smoke: import: expected the import's audit events (upload, mapping, confirmation, run, downloads, undo, sends)" >&2; return 1; }
  [[ "$(q "select count(*) from platform.audit_events where action = 'platform.user_import.report_downloaded'")" -ge "2" ]] ||
    { echo "smoke: import: both downloads (problems list and error report) must be audited" >&2; return 1; }
  if [[ "$(q "select count(*) from platform.audit_events where data::text like '%import-en-%' or data::text like '%import-ar-%'
            or data::text like '%not-an-email%' or data::text like '%=1+2%' or data::text like '%staff-en-%'
            or data::text like '%موظفو-%' or data::text like '%سلمان%' or data::text like '%لمى%' or data::text like '%نواف%'")" != "0" ]]; then
    echo "smoke: import: personal data or file contents reached the audit log" >&2; return 1
  fi
  # The import's files are kept for the import's retention only (class 'import'): the upload and the error
  # report from their first use (7 days), the review's list of problems with the review (24 hours unused).
  [[ "$(q "select count(*) from platform.files f join platform.user_imports u on u.tenant_id = f.tenant_id and f.id in (u.file_id, u.report_file_id)
          where u.file_name like 'staff-en-%' and f.retention_class = 'import' and f.used_at is not null and f.status = 'clean'")" == "2" ]] ||
    { echo "smoke: import: the English import's upload and error report must be clean, in use, with the import retention" >&2; return 1; }
  [[ "$(q "select count(*) from platform.files f join platform.user_imports u on u.tenant_id = f.tenant_id and f.id = u.review_file_id
          where u.file_name like 'staff-en-%' and f.retention_class = 'import' and f.purpose = 'platform.user_import_report'")" == "1" ]] ||
    { echo "smoke: import: the English import's list of problems must be a report with the import retention" >&2; return 1; }
  # Both reports are XLSX workbooks of plain text (security review L2), as the worker stored them.
  [[ "$(q "select count(*) from platform.files f join platform.user_imports u on u.tenant_id = f.tenant_id and f.id in (u.review_file_id, u.report_file_id)
          where u.file_name like 'staff-en-%' and f.detected_mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            and f.original_name like '%.xlsx'")" == "2" ]] ||
    { echo "smoke: import: the list of problems and the error report must be XLSX" >&2; return 1; }
  # No address, name, cell or file name of the imports in the logs (the files' contents are personal data).
  local logs leak
  logs="$(compose logs --no-log-prefix app worker storage gateway clamd 2>&1)"
  for leak in import-en- import-ar- not-an-email '=1+2' staff-en- 'موظفو-' \
    "$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' 'موظفو-')" 'سلمان' 'لمى' 'نواف' 'السبيعي'; do
    if grep -qF -- "$leak" <<<"$logs"; then
      echo "smoke: import: an address, name, cell or file name of an import appears in the container logs" >&2; return 1
    fi
  done
}
