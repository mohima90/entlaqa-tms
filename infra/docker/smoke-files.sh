# shellcheck shell=bash
# Self-hosted smoke, file storage and malware scanning (T-M2-18, ADR 0006 Verification 2–4, ADR 0010 §7).
# Sourced by smoke.sh, which provides compose, q (psql as the migration role), secret and
# AUTH_APIKEY_HEADER, and has started the stack (Storage behind the gateway, the workers). Exercises the
# real Storage API, our storage policies, the workers' scan task and clamd:
#   - a member's own session (never a Storage key), sent by the APP on the gateway's internal port 8445,
#     gets a signed upload URL for the key of their pending upload only; the browser-style PUT (after its
#     CORS preflight) stores a UTF-8 CSV; confirmation queues the scan; the worker detects the type by
#     content, hashes it, scans it with clamd: clean;
#   - downloads: no signed URL without a grant, nor for another owner entity than the file's; with a grant,
#     a 60-second URL that downloads the bytes as an attachment with the Arabic name, nosniff and a
#     sandboxing CSP;
#   - the browser side cannot create signed URLs at all (security review M2): the published port refuses
#     both sign POSTs — even with the member's token and a valid grant, e.g. for a 10-year link — and the
#     internal port answers the app's network only;
#   - the EICAR test file (built here from parts, never stored in the repository) is found, recorded as
#     infected, moved to quarantine, audited, and can never be granted;
#   - a renamed executable is rejected by content and its object removed;
#   - with clamd stopped, an upload stays unscanned (never clean) and is scanned once clamd is back; with
#     signatures older than the limit nothing is scanned (the stack raises the limit for the pinned image's
#     signatures: FILE_SCAN_SIGNATURES_MAX_AGE_DAYS; this checks a 1-day limit refuses them);
#   - Storage's own API is closed at the gateway except the signed-URL paths; the worker's Storage port is
#     not reachable from the app or the host; Storage's JWT secret is in the storage container only; no
#     file name, token or content in any log.
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

# files_storage <method> <path below /storage/v1> <bearer or empty> [curl args…]: the BROWSER side, the
# published gateway port 8443 — "<body>\n<status>".
files_storage() {
  local method="$1" path="$2" bearer="$3"
  shift 3
  curl -s -w '\n%{http_code}' --cacert .secrets/ca.crt -X "$method" -H "$AUTH_APIKEY_HEADER" \
    ${bearer:+-H "Authorization: Bearer $bearer"} "$@" "https://localhost:8443/storage/v1$path"
}
files_status() { printf '%s' "${1##*$'\n'}"; }
files_body() { printf '%s' "${1%$'\n'*}"; }

# files_sign <path below /storage/v1> <bearer or empty> [JSON body]: a POST on the gateway's INTERNAL port
# 8445 from the app container — how the web app asks Storage for signed URLs, with the user's own
# session (the only network that may) — "<body>\n<status>".
files_sign() {
  compose exec -T app /nodejs/bin/node -e '
    const [path, bearer, body] = process.argv.slice(1);
    const headers = { apikey: "self-hosted", "content-type": "application/json" };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    fetch(`https://gateway:8445/storage/v1${path}`, { method: "POST", headers, body: body || "{}" }).then(
      async (r) => process.stdout.write(`${await r.text()}\n${r.status}`),
      () => process.stdout.write("\n000"));' "$1" "$2" "${3:-}"
}

# files_upload <claims> <token> <file> <name> <type> → prints the file id (pending → PUT → confirmed).
files_upload() {
  local claims="$1" token="$2" file="$3" name="$4" type="$5" row id key response url
  row="$(files_as_user "$claims" "select id || '|' || object_key from private.create_file_upload('platform.user_import',
    'platform', 'user_import', gen_random_uuid(), '$name', '$type', $(wc -c <"$file"))")"
  id="${row%%|*}"
  key="${row#*|}"
  [[ -n "$id" && "$key" == */* ]] || { echo "smoke: the member could not reserve an upload" >&2; return 1; }
  response="$(files_sign "/object/upload/sign/imports/$key" "$token")"
  [[ "$(files_status "$response")" == "200" ]] ||
    { echo "smoke: the member's session got no signed upload URL (HTTP $(files_status "$response"))" >&2; return 1; }
  url="$(files_json "$(files_body "$response")" url)"
  [[ "$url" == "/object/upload/sign/imports/$key?token="* ]] ||
    { echo "smoke: unexpected signed upload URL" >&2; return 1; }
  # The browser's CORS preflight for its PUT (the app's origin is not Storage's): answered, PUT allowed.
  local preflight
  preflight="$(curl -s -o /dev/null -D - --cacert .secrets/ca.crt -X OPTIONS -H 'Origin: http://localhost:3200' \
    -H 'Access-Control-Request-Method: PUT' -H 'Access-Control-Request-Headers: content-type' \
    "https://localhost:8443/storage/v1${url}")"
  grep -qiE '^HTTP/[0-9.]+ 20[04]' <<<"$preflight" && grep -qi '^access-control-allow-origin:' <<<"$preflight" &&
    grep -qiE '^access-control-allow-methods:.*PUT' <<<"$preflight" ||
    { echo "smoke: the CORS preflight of the browser's upload was not answered" >&2; return 1; }
  # The browser's PUT: no session, only the URL's token; its answer is readable from the app's origin.
  local put_headers
  put_headers="$(mktemp)"
  response="$(files_storage PUT "${url}" '' -H "Content-Type: $type" -H 'Origin: http://localhost:3200' \
    -D "$put_headers" --data-binary "@$file")"
  [[ "$(files_status "$response")" == "200" ]] ||
    { echo "smoke: the upload with the signed URL failed (HTTP $(files_status "$response"))" >&2; rm -f "$put_headers"; return 1; }
  grep -qi '^access-control-allow-origin:' "$put_headers" ||
    { echo "smoke: the upload's answer is not readable by the browser (no CORS header)" >&2; rm -f "$put_headers"; return 1; }
  rm -f "$put_headers"
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
  local work response token refresh session_id user_id claims csv_id eicar_id exe_id wait_id stale_id key url signed entity
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

  echo "smoke: files — downloads only with a grant for the file's own owner entity: a short-lived attachment URL"
  response="$(files_sign "/object/sign/imports/$key" "$token" '{"expiresIn":60}')"
  [[ "$(files_status "$response")" =~ ^4[0-9][0-9]$ ]] ||
    { echo "smoke: files: a signed download URL without a grant (HTTP $(files_status "$response"))" >&2; return 1; }
  entity="$(q "select owner_entity_id from platform.files where id = '$csv_id'")"
  if files_as_user "$claims" "select * from private.grant_file_download('$csv_id', 'platform.user_import', 'platform',
       'user_import', gen_random_uuid())" >/dev/null 2>&1; then
    echo "smoke: files: a download grant for another owner entity than the file's" >&2; return 1
  fi
  [[ "$(files_as_user "$claims" "select bucket || '|' || ttl_seconds from private.grant_file_download('$csv_id',
          'platform.user_import', 'platform', 'user_import', '$entity')")" == "imports|60" ]] ||
    { echo "smoke: files: no download grant for the clean file" >&2; return 1; }
  # The browser side cannot mint a link — not even the member, with their own token and a valid grant, for
  # 10 years (security review M2) — nor an upload URL: the published port refuses both sign POSTs.
  for path in "/object/sign/imports/$key" "/object/upload/sign/imports/$key" "/object/sign/imports"; do
    response="$(files_storage POST "$path" "$token" -H 'Content-Type: application/json' \
      --data-binary '{"expiresIn":315360000,"paths":["x"]}')"
    [[ "$(files_status "$response")" == "403" ]] ||
      { echo "smoke: files: the published port lets a browser create a signed URL ($path, HTTP $(files_status "$response"))" >&2; return 1; }
  done
  response="$(files_sign "/object/sign/imports/$key" "$token" '{"expiresIn":60}')"
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
  # The saved name is not covered by the URL's signature: the gateway serves only the link as the app makes
  # it — never a name with another extension (a clean CSV saved as .hta), a second name, or no attachment.
  for altered in "https://localhost:8443/storage/v1${signed}&download=report.hta" \
    "https://localhost:8443/storage/v1${signed}&download=report.csv&download=report.js" \
    "https://localhost:8443/storage/v1${signed}&DOWNLOAD=report.csv" \
    "https://localhost:8443/storage/v1${signed}"; do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' --cacert .secrets/ca.crt "$altered")" == "403" ]] ||
      { echo "smoke: files: the gateway served a download link the app does not make" >&2; return 1; }
  done
  # The extension's case is free (an uploader's `.CSV` is kept): still an attachment.
  curl -sf --cacert .secrets/ca.crt -D "$work/headers-upper" -o /dev/null \
    "https://localhost:8443/storage/v1${signed}&download=report.CSV" &&
    grep -qi '^content-disposition: attachment' "$work/headers-upper" ||
    { echo "smoke: files: a download named with an upper-case extension was not served as an attachment" >&2; return 1; }

  echo "smoke: files — Storage refuses what the policies do not allow"
  for path in "/object/upload/sign/imports/$key" \
    "/object/upload/sign/imports/${key%/*}/$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')" \
    "/object/upload/sign/quarantine/$key"; do
    response="$(files_sign "$path" "$token")"
    [[ "$(files_status "$response")" =~ ^4[0-9][0-9]$ ]] ||
      { echo "smoke: files: a signed upload URL for a key that is not a pending upload ($path)" >&2; return 1; }
  done
  response="$(files_sign "/object/sign/imports/$key" '' '{"expiresIn":60}')"
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
  # The internal signing port 8445 serves the two sign POSTs and nothing else, even to the app.
  local codes
  codes="$(compose exec -T app /nodejs/bin/node -e '
    const [key, bearer] = process.argv.slice(1);
    const calls = [["GET", `/object/sign/imports/${key}?token=x`], ["PUT", `/object/upload/sign/imports/${key}?token=x`],
      ["GET", `/object/authenticated/imports/${key}`], ["POST", "/object/list/imports"], ["DELETE", `/object/imports/${key}`],
      ["GET", "/bucket"], ["POST", "/object/move"], ["GET", "/status"]];
    Promise.all(calls.map(([method, path]) => fetch(`https://gateway:8445/storage/v1${path}`,
      { method, headers: { authorization: `Bearer ${bearer}` } }).then((r) => r.status, () => 0)))
      .then((s) => process.stdout.write(s.join(" ")));' "$key" "$token")"
  [[ "$codes" =~ ^((403|404)\ ?){8}$ ]] ||
    { echo "smoke: files: the internal signing port serves more than the sign POSTs ($codes)" >&2; return 1; }
  # The worker's Storage port answers the workers only; the signing port the app only (not published, not
  # the workers, not the host through a bridge).
  local code
  code="$(compose exec -T app /nodejs/bin/node -e \
    'fetch(process.argv[1]).then((r) => process.stdout.write(String(r.status)), () => process.stdout.write("000"))' \
    "https://gateway:8444/storage/v1/object/authenticated/imports/$key")"
  [[ "$code" == "403" ]] || { echo "smoke: files: the app reached the worker's Storage port (got $code)" >&2; return 1; }
  code="$(compose exec -T --index 1 worker /nodejs/bin/node -e \
    'fetch(process.argv[1], { method: "POST" }).then((r) => process.stdout.write(String(r.status)), () => process.stdout.write("000"))' \
    "https://gateway:8445/storage/v1/object/sign/imports/$key")"
  [[ "$code" == "403" || "$code" == "000" ]] ||
    { echo "smoke: files: a worker reached the signing port (got $code)" >&2; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --cacert .secrets/ca.crt -X POST \
    "https://localhost:8445/storage/v1/object/sign/imports/$key" || true)"
  [[ "$code" == "000" ]] || { echo "smoke: files: the signing port is published (got $code)" >&2; return 1; }
  for address in $($DOCKER inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$(compose ps -q gateway)"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --cacert .secrets/ca.crt --resolve "gateway:8445:$address" \
      -X POST "https://gateway:8445/storage/v1/object/sign/imports/$key" || true)"
    [[ "$code" == "403" || "$code" == "000" ]] ||
      { echo "smoke: files: the host reached the signing port at $address (got $code)" >&2; return 1; }
  done

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

  echo "smoke: files — fail closed: signatures older than the limit, and nothing is scanned"
  # The workers stopped, one pass with a 1-day limit (the pinned image's signatures are older): it scans
  # nothing and says so as an error; the upload waits. Then the workers (limit raised for this stack) scan it.
  compose stop worker >/dev/null 2>&1
  stale_id="$(files_upload "$claims" "$token" "$work/staff.csv" 'stale.csv' 'text/csv')"
  local pass
  pass="$(FILE_SCAN_SIGNATURES_MAX_AGE_DAYS=1 compose run --rm --no-deps -T worker main.mjs once 2>&1 || true)"
  grep -q 'NOTHING is scanned' <<<"$pass" ||
    { echo "smoke: files: a pass with too old signatures did not refuse to scan" >&2; compose start worker >/dev/null 2>&1; return 1; }
  [[ "$(q "select status from platform.files where id = '$stale_id'")" == "uploaded" ]] ||
    { echo "smoke: files: a file was scanned with too old signatures" >&2; compose start worker >/dev/null 2>&1; return 1; }
  compose start worker >/dev/null 2>&1
  files_wait "$stale_id" clean 150

  echo "smoke: files — the scanner check and the signature age"
  local check
  check="$(compose run --rm --no-deps worker main.mjs scanner-check 2>&1 || true)"
  grep -q 'scanner ClamAV 1\.' <<<"$check" || { echo "smoke: files: scanner-check did not reach clamd" >&2; return 1; }
  # The pinned image's signatures are older than 24 hours (no freshclam in this test): reported as stale
  # under the stack's raised limit, and as too old (exit code 3: nothing would be scanned) under one day.
  grep -q 'scanner_signatures_stale' <<<"$check" ||
    { echo "smoke: files: stale signatures were not reported" >&2; return 1; }
  local status=0
  check="$(FILE_SCAN_SIGNATURES_MAX_AGE_DAYS=1 compose run --rm --no-deps -T worker main.mjs scanner-check 2>&1)" || status=$?
  [[ $status -eq 3 ]] && grep -q 'scanner_signatures_too_old' <<<"$check" ||
    { echo "smoke: files: signatures older than the limit were not reported as too old (exit $status)" >&2; return 1; }
  # The raised limit is a test-only setting: without its override flag the worker refuses to start.
  status=0
  check="$(FILE_SCAN_SIGNATURES_TEST_OVERRIDE='' compose run --rm --no-deps -T worker main.mjs scanner-check 2>&1)" || status=$?
  [[ $status -ne 0 ]] && grep -q 'needs FILE_SCAN_SIGNATURES_TEST_OVERRIDE=1' <<<"$check" ||
    { echo "smoke: files: a raised signature limit was accepted without the test-only override" >&2; return 1; }

  echo "smoke: files — Storage's JWT secret (admin-equivalent) is in the storage container only"
  local storage_secret holders=""
  storage_secret="$(secret STORAGE_JWT_SECRET)"
  for id in $(compose ps -a -q); do
    if $DOCKER inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$id" | grep -qF "$storage_secret"; then
      holders="$holders $($DOCKER inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$id")"
    fi
  done
  [[ "$holders" == " storage" ]] ||
    { echo "smoke: files: STORAGE_JWT_SECRET is held by:${holders:- nobody} (expected: storage only)" >&2; return 1; }

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
