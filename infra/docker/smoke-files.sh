# shellcheck shell=bash
# Self-hosted smoke, file storage and malware scanning (T-M2-18, ADR 0006 Verification 2–4, ADR 0010 §7).
# Sourced by smoke.sh, which provides compose, q (psql as the migration role), secret and
# AUTH_APIKEY_HEADER, and has started the stack (Storage behind the gateway, the workers). Exercises the
# real Storage API, our storage policies, the workers' scan task and clamd:
#   - a member's own session (never a Storage key) gets a signed upload URL for the key of their pending
#     upload only; the browser-style PUT stores a UTF-8 CSV; confirmation queues the scan; the worker
#     detects the type by content, hashes it, scans it with clamd: clean;
#   - downloads: no signed URL without a grant; with a grant, a 60-second URL that downloads the bytes as
#     an attachment with the Arabic name, nosniff and a sandboxing CSP;
#   - the EICAR test file (built here from parts, never stored in the repository) is found, recorded as
#     infected, moved to quarantine, audited, and can never be granted;
#   - a renamed executable is rejected by content and its object removed;
#   - with clamd stopped, an upload stays unscanned (never clean) and is scanned once clamd is back;
#   - Storage's own API is closed at the gateway except the signed-URL paths; the worker's Storage port is
#     not reachable from the app or the host; no file name, token or content in any log.
# Usage: files_journey <user e-mail> <password> <organization slug>

# files_json <JSON> <field>: one field of a JSON object (empty when missing).
files_json() { node -e 'try { const v = JSON.parse(process.argv[1])[process.argv[2]]; process.stdout.write(v == null ? "" : String(v)); } catch {}' "$1" "$2"; }

# files_claims <access token>: the claims the web app's withUserTx forwards to PostgreSQL (allow-list).
files_claims() {
  node -e 'const p = JSON.parse(Buffer.from(process.argv[1].split(".")[1], "base64url"));
    const out = {}; for (const k of ["sub", "role", "session_id", "tenant_id", "person_id", "aal"]) if (typeof p[k] === "string") out[k] = p[k];
    process.stdout.write(JSON.stringify(out));' "$1"
}

# files_as_user <claims JSON> <SQL>: one statement as the web app runs it (login app_server, role
# authenticated, the user's claims), rows printed unaligned.
files_as_user() {
  PGPASSWORD="$(secret APP_SERVER_DB_PASSWORD)" PGSSLMODE=verify-full PGSSLROOTCERT=.secrets/ca.crt \
    psql -h localhost -p 55432 -U app_server -d postgres -X -q -At -v ON_ERROR_STOP=1 \
    -c 'begin' -c 'set local role authenticated' \
    -c "set local request.jwt.claims = '$1'" -c "$2" -c 'commit'
}

# files_storage <method> <path below /storage/v1> <bearer or empty> [curl args…]: "<status>\n<body>".
files_storage() {
  local method="$1" path="$2" bearer="$3"
  shift 3
  curl -s -w '\n%{http_code}' --cacert .secrets/ca.crt -X "$method" -H "$AUTH_APIKEY_HEADER" \
    ${bearer:+-H "Authorization: Bearer $bearer"} "$@" "https://localhost:8443/storage/v1$path"
}
files_status() { printf '%s' "${1##*$'\n'}"; }
files_body() { printf '%s' "${1%$'\n'*}"; }

# files_upload <claims> <token> <file> <name> <type> → prints the file id (pending → PUT → confirmed).
files_upload() {
  local claims="$1" token="$2" file="$3" name="$4" type="$5" row id key response url
  row="$(files_as_user "$claims" "select id || '|' || object_key from private.create_file_upload('platform.user_import',
    'platform', 'user_import', gen_random_uuid(), '$name', '$type', $(wc -c <"$file"))")"
  id="${row%%|*}"
  key="${row#*|}"
  [[ -n "$id" && "$key" == */* ]] || { echo "smoke: the member could not reserve an upload" >&2; return 1; }
  response="$(files_storage POST "/object/upload/sign/imports/$key" "$token")"
  [[ "$(files_status "$response")" == "200" ]] ||
    { echo "smoke: the member's session got no signed upload URL (HTTP $(files_status "$response"))" >&2; return 1; }
  url="$(files_json "$(files_body "$response")" url)"
  [[ "$url" == "/object/upload/sign/imports/$key?token="* ]] ||
    { echo "smoke: unexpected signed upload URL" >&2; return 1; }
  # The browser's PUT: no session, only the URL's token.
  response="$(files_storage PUT "${url}" '' -H "Content-Type: $type" --data-binary "@$file")"
  [[ "$(files_status "$response")" == "200" ]] ||
    { echo "smoke: the upload with the signed URL failed (HTTP $(files_status "$response"))" >&2; return 1; }
  [[ "$(files_as_user "$claims" "select private.confirm_file_upload('$id')")" == "uploaded" ]] ||
    { echo "smoke: the upload was not confirmed" >&2; return 1; }
  printf '%s\n' "$id"
}

# files_wait <id> <status> [seconds]: until the file has that status (as seen by the migration role).
files_wait() {
  local i
  for i in $(seq 1 "${3:-120}"); do
    [[ "$(q "select status from platform.files where id = '$1'")" == "$2" ]] && return 0
    sleep 1
  done
  echo "smoke: file $1 did not become $2 (it is $(q "select status || ' ' || coalesce(status_reason, '') from platform.files where id = '$1'"))" >&2
  return 1
}

files_journey() {
  local email="$1" password="$2" slug="$3"
  local work response token refresh session_id user_id claims csv_id eicar_id exe_id wait_id key url signed
  work="$(mktemp -d)"

  # A member's own Auth session, acting in the organization (as the sign-in flow selects it), refreshed so
  # the access-token hook adds the organization claim.
  response="$(curl -s -w '\n%{http_code}' --cacert .secrets/ca.crt -X POST -H 'Content-Type: application/json' \
    -H "$AUTH_APIKEY_HEADER" --data-binary "{\"email\":\"$email\",\"password\":\"$password\"}" \
    'https://localhost:8443/auth/v1/token?grant_type=password')"
  [[ "$(files_status "$response")" == "200" ]] || { echo "smoke: files: the member could not sign in" >&2; return 1; }
  token="$(files_json "$(files_body "$response")" access_token)"
  refresh="$(files_json "$(files_body "$response")" refresh_token)"
  session_id="$(files_json "$(files_claims "$token")" session_id)"
  user_id="$(files_json "$(files_claims "$token")" sub)"
  q "insert into platform.session_context (session_id, user_id, active_tenant_id)
     select '$session_id', '$user_id', id from platform.tenants where slug = '$slug'" >/dev/null
  response="$(curl -s -w '\n%{http_code}' --cacert .secrets/ca.crt -X POST -H 'Content-Type: application/json' \
    -H "$AUTH_APIKEY_HEADER" --data-binary "{\"refresh_token\":\"$refresh\"}" \
    'https://localhost:8443/auth/v1/token?grant_type=refresh_token')"
  token="$(files_json "$(files_body "$response")" access_token)"
  claims="$(files_claims "$token")"
  [[ -n "$(files_json "$claims" tenant_id)" ]] || { echo "smoke: files: no organization claim" >&2; return 1; }

  echo "smoke: files — the member's own session uploads a UTF-8 CSV through a signed URL; the worker scans it clean"
  printf '%s\n%s\n' 'البريد الإلكتروني,الاسم الأول,اسم العائلة' 'sara@files.example,سارة,القحطاني' >"$work/staff.csv"
  csv_id="$(files_upload "$claims" "$token" "$work/staff.csv" 'موظفو الرياض.csv' 'text/csv')"
  files_wait "$csv_id" clean
  [[ "$(q "select concat_ws('|', detected_mime, size_bytes, sha256, scan_engine like 'ClamAV %', scan_signatures <> '')
          from platform.files where id = '$csv_id'")" == "text/csv|$(wc -c <"$work/staff.csv")|$(sha256sum "$work/staff.csv" | cut -d' ' -f1)|t|t" ]] ||
    { echo "smoke: files: the clean CSV lacks its detected type, size, hash or scan engine" >&2; return 1; }
  key="$(q "select object_key from platform.files where id = '$csv_id'")"
  [[ "$(q "select count(*) from platform.event_outbox where subject = '$csv_id' and type in ('com.entlaqa.platform.file.uploaded', 'com.entlaqa.platform.file.scanned')")" == "1" ]] ||
    { echo "smoke: files: expected the file.scanned event (the uploaded one is the app's: not emitted by psql)" >&2; return 1; }

  echo "smoke: files — downloads only with a grant: a short-lived attachment URL"
  response="$(files_storage POST "/object/sign/imports/$key" "$token" -H 'Content-Type: application/json' --data-binary '{"expiresIn":60}')"
  [[ "$(files_status "$response")" =~ ^4[0-9][0-9]$ ]] ||
    { echo "smoke: files: a signed download URL without a grant (HTTP $(files_status "$response"))" >&2; return 1; }
  [[ "$(files_as_user "$claims" "select bucket || '|' || ttl_seconds from private.grant_file_download('$csv_id')")" == "imports|60" ]] ||
    { echo "smoke: files: no download grant for the clean file" >&2; return 1; }
  response="$(files_storage POST "/object/sign/imports/$key" "$token" -H 'Content-Type: application/json' --data-binary '{"expiresIn":60}')"
  [[ "$(files_status "$response")" == "200" ]] ||
    { echo "smoke: files: no signed download URL with a grant (HTTP $(files_status "$response"))" >&2; return 1; }
  signed="$(files_json "$(files_body "$response")" signedURL)"
  url="https://localhost:8443/storage/v1${signed}&download=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' 'موظفو الرياض.csv')"
  curl -sf --cacert .secrets/ca.crt -D "$work/headers" -o "$work/downloaded.csv" "$url" ||
    { echo "smoke: files: the signed download URL did not work" >&2; return 1; }
  cmp -s "$work/staff.csv" "$work/downloaded.csv" || { echo "smoke: files: downloaded bytes differ" >&2; return 1; }
  grep -qi '^x-content-type-options: nosniff' "$work/headers" &&
    grep -qi "^content-security-policy: default-src 'none'; sandbox" "$work/headers" &&
    grep -qi '^content-disposition: attachment' "$work/headers" &&
    grep -qi "filename\*=UTF-8''%D9%85%D9%88%D8%B8%D9%81%D9%88" "$work/headers" ||
    { echo "smoke: files: the download lacks nosniff, the sandbox CSP or the attachment with its Arabic name" >&2; return 1; }
  # A refused download (altered token) is not logged with its file name (checked with the logs below).
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --cacert .secrets/ca.crt "${url/token=/token=x}")" =~ ^4[0-9][0-9]$ ]] ||
    { echo "smoke: files: a download with an altered token was served" >&2; return 1; }

  echo "smoke: files — Storage refuses what the policies do not allow"
  for path in "/object/upload/sign/imports/$key" \
    "/object/upload/sign/imports/${key%/*}/$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')" \
    "/object/upload/sign/quarantine/$key"; do
    response="$(files_storage POST "$path" "$token")"
    [[ "$(files_status "$response")" =~ ^4[0-9][0-9]$ ]] ||
      { echo "smoke: files: a signed upload URL for a key that is not a pending upload ($path)" >&2; return 1; }
  done
  response="$(files_storage POST "/object/sign/imports/$key" '' -H 'Content-Type: application/json' --data-binary '{"expiresIn":60}')"
  [[ "$(files_status "$response")" =~ ^4[0-9][0-9]$ ]] ||
    { echo "smoke: files: a signed URL with the publishable key alone" >&2; return 1; }
  # Storage's API beyond the signed-URL paths is closed at the published gateway port (direct reads,
  # listing, direct uploads, deletes, buckets), whatever the session.
  for call in "GET /object/authenticated/imports/$key" "GET /object/imports/$key" "POST /object/list/imports" \
    "POST /object/imports/${key%/*}/x" "DELETE /object/imports/$key" "GET /bucket" "POST /object/move" \
    "GET /object/public/imports/$key"; do
    response="$(files_storage "${call%% *}" "${call#* }" "$token" -H 'Content-Type: application/json' --data-binary '{}')"
    [[ "$(files_status "$response")" == "404" || "$(files_status "$response")" == "403" ]] ||
      { echo "smoke: files: the gateway serves Storage's $call (HTTP $(files_status "$response"))" >&2; return 1; }
  done
  # The worker's Storage port answers the workers only.
  local code
  code="$(compose exec -T app /nodejs/bin/node -e \
    'fetch(process.argv[1]).then((r) => process.stdout.write(String(r.status)), () => process.stdout.write("000"))' \
    "https://gateway:8444/storage/v1/object/authenticated/imports/$key")"
  [[ "$code" == "403" ]] || { echo "smoke: files: the app reached the worker's Storage port (got $code)" >&2; return 1; }

  echo "smoke: files — the EICAR test file is found, quarantined, audited and never downloadable"
  # Built from parts at run time: the test string never sits in the repository (antivirus, secret scan).
  local e1='X5O!P%@AP[4\PZX54(P^)7CC)7}$' e2='EICAR-STANDARD-ANTIVIRUS-' e3='TEST-FILE!$H+H*'
  printf '%s%s%s' "$e1" "$e2" "$e3" >"$work/eicar.csv"
  eicar_id="$(files_upload "$claims" "$token" "$work/eicar.csv" 'تقرير.csv' 'text/csv')"
  files_wait "$eicar_id" infected
  [[ "$(q "select concat_ws('|', status_reason, scan_finding ilike '%eicar%') from platform.files where id = '$eicar_id'")" == "malware|t" ]] ||
    { echo "smoke: files: the EICAR finding was not recorded" >&2; return 1; }
  for i in $(seq 1 60); do
    [[ "$(q "select bucket from platform.files where id = '$eicar_id'")" == "quarantine" ]] && break
    [[ $i -eq 60 ]] && { echo "smoke: files: the infected object was not moved to quarantine" >&2; return 1; }
    sleep 1
  done
  [[ "$(q "select string_agg(bucket_id, ',') from storage.objects where name = (select object_key from platform.files where id = '$eicar_id')")" == "quarantine" ]] ||
    { echo "smoke: files: the infected object is not (only) in the quarantine bucket" >&2; return 1; }
  [[ "$(q "select count(*) from platform.audit_events where action = 'platform.file.infected' and entity_id = '$eicar_id' and actor_user_id is null")" == "1" ]] ||
    { echo "smoke: files: no security audit event for the infected file" >&2; return 1; }
  if files_as_user "$claims" "select * from private.grant_file_download('$eicar_id')" >/dev/null 2>&1; then
    echo "smoke: files: an infected file was granted for download" >&2; return 1
  fi

  echo "smoke: files — a renamed executable is rejected by content and its object removed"
  printf 'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00PE-renamed-as-csv' >"$work/payroll.csv"
  exe_id="$(files_upload "$claims" "$token" "$work/payroll.csv" 'payroll.csv' 'text/csv')"
  files_wait "$exe_id" rejected
  [[ "$(q "select status_reason || '|' || detected_mime from platform.files where id = '$exe_id'")" == "type_not_allowed|application/x-msdownload" ]] ||
    { echo "smoke: files: the renamed executable was not rejected by its content" >&2; return 1; }
  for i in $(seq 1 60); do
    [[ "$(q "select count(*) from storage.objects where name = (select object_key from platform.files where id = '$exe_id')")" == "0" ]] && break
    [[ $i -eq 60 ]] && { echo "smoke: files: the rejected object was not removed" >&2; return 1; }
    sleep 1
  done

  echo "smoke: files — fail closed: with the scanner down, an upload waits (never clean) until it is back"
  compose stop clamd >/dev/null 2>&1
  wait_id="$(files_upload "$claims" "$token" "$work/staff.csv" 'later.csv' 'text/csv')"
  sleep 20
  [[ "$(q "select status from platform.files where id = '$wait_id'")" =~ ^(uploaded|scanning)$ ]] ||
    { echo "smoke: files: a file became $(q "select status from platform.files where id = '$wait_id'") without a scanner" >&2; return 1; }
  compose start clamd >/dev/null 2>&1
  compose up -d --wait clamd >/dev/null 2>&1
  # Its next attempt is due now (instead of after its back-off); the workers pick it up within a minute.
  q "update platform.files set scan_not_before = now() where id = '$wait_id'" >/dev/null
  files_wait "$wait_id" clean 150

  echo "smoke: files — the scanner check and the signature age"
  local check
  check="$(compose run --rm --no-deps worker main.mjs scanner-check 2>&1 || true)"
  grep -q 'scanner ClamAV 1\.' <<<"$check" || { echo "smoke: files: scanner-check did not reach clamd" >&2; return 1; }
  # The pinned image's signatures are older than 24 hours (no freshclam in this test): reported.
  grep -q 'scanner_signatures_stale' <<<"$check" ||
    { echo "smoke: files: stale signatures were not reported" >&2; return 1; }

  echo "smoke: files — no name, token or content in the logs"
  local logs
  logs="$(compose logs --no-log-prefix app worker storage gateway clamd 2>&1)"
  for leak in 'موظفو الرياض' "$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' 'موظفو')" \
    'سارة' 'sara@files.example' 'تقرير' "$token" "${url#*token=}"; do
    if grep -qF "${leak%%&*}" <<<"$logs"; then
      echo "smoke: files: a file name, content or token appears in the container logs" >&2; return 1
    fi
  done
  grep -q 'security: file .* is infected' <<<"$(compose logs --no-log-prefix worker 2>&1)" ||
    { echo "smoke: files: the worker did not log the infected file as a security event" >&2; return 1; }
  rm -rf "$work"
}
