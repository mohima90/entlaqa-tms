#!/usr/bin/env bash
# Self-hosted (sovereign) smoke test, T-M1-D04/D06: brings up the whole stack from this directory, deploys
# the migrations with the production deploy script, creates a user (through the operators' admin-cli) and
# an organization, signs in through a real browser against the app container, checks the audit trail and
# TLS, runs two background-job workers and checks they dispatch an event, sends a test e-mail over SMTP
# with STARTTLS to the stand-in relay (Mailpit), runs the invitation journey (invite in the UI, e-mail,
# accept link from Mailpit, set a password, signed in; expired/revoked/used links; Auth's sign-up hook
# refuses sign-ups without a valid invitation for that e-mail), runs the password reset (forgot page, OUR
# e-mail from Mailpit — sent by the worker, T-M2-17 — new password, old one refused, link single use, our
# "password changed" notice; Auth's admin API only on the gateway's internal port, only its calls per
# network), deactivates and reactivates members (reassignment, sessions end at once, the worker's Auth ban
# and its lifting — T-M2-09), sends a browser and a server error to the in-country error tracker
# (GlitchTip) and checks they arrive without personal data, then tears everything down.
#
#   bash infra/docker/smoke.sh            # KEEP=1 leaves the stack running; SKIP_BUILD=1 reuses the build
#
# Needs: Docker with compose, Node + pnpm (repo installed), psql, Playwright Chromium.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT/infra/docker"
DOCKER="${DOCKER:-docker}"
compose() { $DOCKER compose --env-file .secrets/.env "$@"; }

cleanup() {
  local status=$?
  if [[ $status -ne 0 ]]; then compose logs --tail 40 >&2 || true; fi
  if [[ "${KEEP:-0}" != "1" ]]; then compose down -v >/dev/null 2>&1 || true; fi
  if [[ $status -eq 0 ]]; then echo "smoke: PASSED"; else echo "smoke: FAILED (exit $status)" >&2; fi
}
trap cleanup EXIT

./gen-secrets.sh
# Only the values this script needs, read one by one (never the whole file into the environment, so the
# Auth password and the signing key are not handed to every child process). Passwords are alphanumeric.
secret() { sed -n "s/^$1=//p" "$ROOT/infra/docker/.secrets/.env"; }
POSTGRES_PASSWORD="$(secret POSTGRES_PASSWORD)"
CA_PEM="$(cat .secrets/ca.crt)"
# create_user <email> <password>: a confirmed Auth user through the operators' one-off admin-cli
# (create-user.mjs on the internal auth-tools network — the published gateway port serves no admin path);
# prints the user id.
create_user() {
  local new_id
  new_id="$(NEW_USER_PASSWORD="$2" compose run --rm -T --user "$(id -u):$(id -g)" -e NEW_USER_PASSWORD \
    admin-cli "$1")"
  [[ "$new_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] ||
    { echo "smoke: admin-cli did not create the user" >&2; return 1; }
  printf '%s\n' "$new_id"
}
MIGRATION_URL="postgresql://postgres:$POSTGRES_PASSWORD@localhost:55432/postgres"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "smoke: building the app (standalone, no environment baked in) and the worker (bundle)"
  (cd "$ROOT" && pnpm --filter @jadarat/suite --filter @jadarat/worker build >/dev/null)
fi

echo "smoke: starting PostgreSQL, Auth, the TLS gateway and the error tracker (GlitchTip)"
compose up -d --wait db auth gateway errors-db glitchtip
curl -sf --cacert .secrets/ca.crt https://localhost:8443/auth/v1/health >/dev/null ||
  { echo "smoke: Auth is not reachable through the TLS gateway" >&2; exit 1; }

echo "smoke: deploying migrations (scripts/db-deploy.sh, TLS verify-full)"
(cd "$ROOT" && DATABASE_URL="$MIGRATION_URL" DATABASE_CA_CERT="$CA_PEM" \
  APP_SERVER_DB_PASSWORD="$(secret APP_SERVER_DB_PASSWORD)" APP_WORKER_DB_PASSWORD="$(secret APP_WORKER_DB_PASSWORD)" \
  APP_QUEUE_DB_PASSWORD="$(secret APP_QUEUE_DB_PASSWORD)" bash scripts/db-deploy.sh apply)

echo "smoke: setting up GlitchTip (operator account, organization, project) and the app's DSN"
SENTRY_DSN="$(GLITCHTIP_ADMIN_PASSWORD="$(secret GLITCHTIP_ADMIN_PASSWORD)" compose exec -T \
  -e GLITCHTIP_ADMIN_EMAIL=operator@sovereign.example -e GLITCHTIP_ADMIN_PASSWORD glitchtip \
  python manage.py shell <glitchtip/bootstrap.py | sed -n 's/^DSN=//p')"
[[ "$SENTRY_DSN" =~ ^http://[0-9a-f]{32}@glitchtip:8000/[0-9]+$ ]] ||
  { echo "smoke: GlitchTip set-up did not return a DSN" >&2; exit 1; }
# The project (and so the DSN) is new whenever the volumes are: replace any DSN from an earlier run.
grep -v '^SENTRY_DSN=' .secrets/.env >.secrets/.env.new || true
echo "SENTRY_DSN=$SENTRY_DSN" >>.secrets/.env.new && chmod 600 .secrets/.env.new && mv .secrets/.env.new .secrets/.env
# The GlitchTip UI is served over TLS by the gateway; GlitchTip itself has no route out.
[[ "$(curl -s -o /dev/null -w '%{http_code}' --cacert .secrets/ca.crt https://localhost:8100/_health/)" == "200" ]] ||
  { echo "smoke: the GlitchTip UI is not reachable over TLS through the gateway" >&2; exit 1; }
for target in "('example.com', 443)" "('1.1.1.1', 443)"; do # by name and by address (not just DNS)
  if compose exec -T glitchtip python3 -c \
    "import socket; socket.create_connection($target, timeout=5)" >/dev/null 2>&1; then
    echo "smoke: GlitchTip can reach the internet (it must stay in-country)" >&2; exit 1
  fi
done

echo "smoke: starting the app container"
compose up -d --build --wait app
curl -sf http://localhost:3200/api/health/live >/dev/null || { echo "smoke: liveness check failed" >&2; exit 1; }
curl -sf http://localhost:3200/api/health/ready >/dev/null ||
  { echo "smoke: readiness check failed (app cannot reach the database)" >&2; exit 1; }

EMAIL="smoke-$(date +%s)@sovereign.example"
PASSWORD="Smoke-$(openssl rand -hex 16)"
USER_ID="$(create_user "$EMAIL" "$PASSWORD")"
(cd "$ROOT" && DATABASE_URL="$MIGRATION_URL" DATABASE_CA_CERT="$CA_PEM" TENANT_SLUG=sovereign-smoke \
  TENANT_NAME_AR='منشأة الاختبار السيادي' TENANT_NAME_EN='Sovereign Smoke' ADMIN_USER_ID="$USER_ID" \
  ADD_TO_EXISTING=false bash scripts/provision-tenant.sh apply >/dev/null)

echo "smoke: signing in through a real browser"
(cd "$ROOT/apps/suite" && E2E_BASE_URL=http://localhost:3200 SIGNED_IN_E2E_EMAIL="$EMAIL" \
  SIGNED_IN_E2E_PASSWORD="$PASSWORD" SIGNED_IN_E2E_ORGANIZATION_EN='Sovereign Smoke' \
  pnpm exec playwright test e2e/signed-in.spec.ts --project=desktop-chromium)

echo "smoke: Auth parity checks (ADR 0010 §3a: ES256/JWKS, session_id, TOTP MFA → aal2)"
PARITY_EMAIL="parity-$(date +%s)@sovereign.example"
PARITY_PASSWORD="Parity-$(openssl rand -hex 16)"
create_user "$PARITY_EMAIL" "$PARITY_PASSWORD" >/dev/null
PARITY_EMAIL="$PARITY_EMAIL" PARITY_PASSWORD="$PARITY_PASSWORD" node check-auth-parity.mjs

echo "smoke: checking the audit trail, revoked sessions and TLS"
q() {
  PGPASSWORD="$POSTGRES_PASSWORD" PGSSLMODE=verify-full PGSSLROOTCERT=.secrets/ca.crt \
    psql -h localhost -p 55432 -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 -c "$1"
}
[[ "$(q "select count(*) from platform.audit_events where action in ('platform.auth.signed_in', 'platform.auth.signed_out')")" == "2" ]] ||
  { echo "smoke: expected one signed_in and one signed_out audit event" >&2; exit 1; }
[[ "$(q "select count(*) from auth.sessions where user_id = '$USER_ID'")" == "0" ]] ||
  { echo "smoke: sign-out must revoke the session" >&2; exit 1; }
[[ "$(q "select count(*) from pg_stat_ssl s join pg_stat_activity a using (pid) where a.client_addr is not null and not s.ssl")" == "0" ]] ||
  { echo "smoke: a network connection to PostgreSQL is not using TLS" >&2; exit 1; }
# Correct password, no TLS: must be refused by pg_hba.conf (not by anything else).
no_tls="$(PGPASSWORD="$POSTGRES_PASSWORD" PGSSLMODE=disable PGCONNECT_TIMEOUT=5 \
  psql -h localhost -p 55432 -U postgres -d postgres -X -At -c 'select 1' 2>&1 || true)"
[[ "$no_tls" == *"pg_hba.conf rejects connection"* ]] ||
  { echo "smoke: PostgreSQL must refuse connections without TLS (got: $no_tls)" >&2; exit 1; }

echo "smoke: background jobs (T-M2-06a) — two workers install the queue and dispatch an event"
compose up -d --build --wait worker
[[ "$(compose ps -q worker | wc -l)" == "2" ]] || { echo "smoke: expected two worker replicas" >&2; exit 1; }
for i in $(seq 1 30); do
  [[ "$(q "select to_regprocedure('graphile_worker.add_job(text,json,text,timestamp with time zone,integer,text,integer,text[],text)') is not null")" == "t" ]] && break
  [[ $i -eq 30 ]] && { echo "smoke: the worker did not install the job queue" >&2; exit 1; }
  sleep 1
done
[[ "$(q "select nspowner::regrole from pg_namespace where nspname = 'graphile_worker'")" == "app_queue" ]] ||
  { echo "smoke: the job queue must belong to app_queue" >&2; exit 1; }
# No feature emits events yet: the operator writes one (actor 'platform'); the insert queues a dispatch.
q "insert into platform.event_outbox (tenant_id, type) select id, 'com.entlaqa.platform.smoke.checked' from platform.tenants where slug = 'sovereign-smoke'" >/dev/null
for i in $(seq 1 30); do
  [[ "$(q "select count(*) from platform.event_outbox where type = 'com.entlaqa.platform.smoke.checked' and dispatched_at is not null and actor_type = 'platform'")" == "1" ]] && break
  [[ $i -eq 30 ]] && { echo "smoke: the worker did not dispatch the event" >&2; exit 1; }
  sleep 1
done
[[ "$(q "select count(*) from pg_stat_ssl s join pg_stat_activity a using (pid) where a.usename in ('app_queue', 'app_worker') and s.ssl")" -ge "2" ]] ||
  { echo "smoke: the workers must connect over TLS" >&2; exit 1; }

echo "smoke: e-mail (T-M2-06b) — a test e-mail over SMTP with verified STARTTLS reaches the relay (Mailpit)"
compose run --rm -e EMAIL_TEST_TO=smoke-mail@sovereign.example worker main.mjs test-email >/dev/null
for i in $(seq 1 20); do
  mail="$(compose exec -T mailpit wget -qO- http://127.0.0.1:8025/api/v1/messages 2>/dev/null || true)"
  grep -q 'smoke-mail@sovereign.example' <<<"$mail" && grep -qF '[TEST]' <<<"$mail" && break
  [[ $i -eq 20 ]] && { echo "smoke: the test e-mail did not reach Mailpit" >&2; exit 1; }
  sleep 1
done

echo "smoke: users pages (T-M2-04) with sample people, in Arabic and English"
MANAGER_EMAIL="manager-$(date +%s)@sovereign.example"
MANAGER_PASSWORD="Manager-$(openssl rand -hex 16)"
MANAGER_ID="$(create_user "$MANAGER_EMAIL" "$MANAGER_PASSWORD")"
PGPASSWORD="$POSTGRES_PASSWORD" PGSSLMODE=verify-full PGSSLROOTCERT=.secrets/ca.crt \
  psql -h localhost -p 55432 -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -v admin_user="$USER_ID" \
  -v manager_user="$MANAGER_ID" -f seed-users.sql >/dev/null
(cd "$ROOT/apps/suite" && E2E_BASE_URL=http://localhost:3200 SIGNED_IN_E2E_EMAIL="$EMAIL" \
  SIGNED_IN_E2E_PASSWORD="$PASSWORD" SIGNED_IN_E2E_MANAGER_EMAIL="$MANAGER_EMAIL" \
  SIGNED_IN_E2E_MANAGER_PASSWORD="$MANAGER_PASSWORD" \
  pnpm exec playwright test e2e/users.spec.ts --project=desktop-chromium)
# T-M2-13: the edit is audited with the changed field names only (no values).
[[ "$(q "select count(*) from platform.audit_events where action = 'platform.user.updated' and data ? 'changed'")" -ge "1" ]] ||
  { echo "smoke: expected the user-details audit event" >&2; exit 1; }
# T-M2-14: role changes are audited with the roles before and after (BR-IAM-3).
[[ "$(q "select count(*) from platform.audit_events where action = 'platform.user.roles_changed' and data ? 'before' and data ? 'after'")" -ge "1" ]] ||
  { echo "smoke: expected the roles-changed audit event with before and after" >&2; exit 1; }
if [[ "$(q "select count(*) from platform.audit_events where data::text like '%Alshehri%' or data::text like '%EMP-2041%' or data::text like '%محاسب%'")" != "0" ]]; then
  echo "smoke: edited personal data reached the audit log" >&2; exit 1
fi

echo "smoke: invitations, admin side (T-M2-07) — invite, invited tab, resend, revoke, e-mail; in Arabic and English"
# Three more addresses are invited through the form and left pending for the acceptance journey below.
STAMP="$(date +%s)"
INVITEE_EMAIL="invitee-accept-$STAMP@sovereign.example"
EXPIRED_INVITEE="invitee-expired-$STAMP@sovereign.example"
REVOKED_INVITEE="invitee-revoked-$STAMP@sovereign.example"
(cd "$ROOT/apps/suite" && E2E_BASE_URL=http://localhost:3200 SIGNED_IN_E2E_EMAIL="$EMAIL" \
  SIGNED_IN_E2E_PASSWORD="$PASSWORD" INVITE_E2E_PENDING_EMAILS="$INVITEE_EMAIL,$EXPIRED_INVITEE,$REVOKED_INVITEE" \
  pnpm exec playwright test e2e/invitations.spec.ts --project=desktop-chromium)
# mail_ids <address>: IDs of the Mailpit messages sent to <address>, newest first.
mail_ids() {
  compose exec -T mailpit wget -qO- 'http://127.0.0.1:8025/api/v1/messages?limit=500' 2>/dev/null |
    node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { for (const m of JSON.parse(s).messages ?? [])
        if ((m.To ?? []).some((t) => t.Address === process.argv[1])) console.log(m.ID); } catch {} })' "$1"
}
# Every invitee got the invitation e-mail. (The resend of the English one is revoked seconds later, so its
# second e-mail may rightly be skipped by the mailer; the resend itself is checked in the audit trail.)
for i in $(seq 1 60); do
  invitee_en="$(q "select email from platform.invitations where email like 'invitee-en-%' order by created_at desc limit 1")"
  invitee_ar="$(q "select email from platform.invitations where email like 'invitee-ar-%' order by created_at desc limit 1")"
  if [[ -n "$invitee_en" && -n "$invitee_ar" && "$(mail_ids "$invitee_en" | wc -l)" -ge 1 &&
    "$(mail_ids "$invitee_ar" | wc -l)" -ge 1 && "$(mail_ids "$INVITEE_EMAIL" | wc -l)" -ge 1 &&
    "$(mail_ids "$EXPIRED_INVITEE" | wc -l)" -ge 1 && "$(mail_ids "$REVOKED_INVITEE" | wc -l)" -ge 1 ]]; then
    break
  fi
  [[ $i -eq 60 ]] && { echo "smoke: the invitation e-mails did not reach Mailpit" >&2; exit 1; }
  sleep 1
done
[[ "$(q "select count(distinct action) from platform.audit_events where action in ('platform.invitation.created', 'platform.invitation.resend_requested', 'platform.invitation.revoked')")" == "3" ]] ||
  { echo "smoke: expected the invitation audit events (created, resend_requested, revoked)" >&2; exit 1; }
if [[ "$(q "select count(*) from platform.audit_events where action like 'platform.invitation.%' and (data::text like '%invitee-%' or data::text like '%Noura%' or data::text like '%نورة%' or data::text like '%ريم%')")" != "0" ]]; then
  echo "smoke: invitation personal data reached the audit log" >&2; exit 1
fi

echo "smoke: accepting an invitation (T-M2-07) — link from the e-mail, set a password, signed in; link states"
# accept_link <address>: the accept link in the newest e-mail to <address> (the same link in the text and
# HTML parts), whole and unchanged: the token travels in the query (?token=) or the fragment (#token=).
# The token exists only there: never echo these links (they are credentials).
accept_link() {
  local id
  id="$(mail_ids "$1" | sed -n 1p)"
  [[ -n "$id" ]] || return 1
  compose exec -T mailpit wget -qO- "http://127.0.0.1:8025/api/v1/message/$id" 2>/dev/null |
    node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const re = /http:\/\/localhost:3200\/(ar|en)\/invite\/accept[?#]token=[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;
      let m = {}; try { m = JSON.parse(s); } catch {}
      const text = (m.Text ?? "").match(re), html = (m.HTML ?? "").match(re);
      if (!text || !html || text[0] !== html[0]) process.exit(1);
      process.stdout.write(text[0]); })'
}
ACCEPT_URL="$(accept_link "$INVITEE_EMAIL")" || { echo "smoke: no accept link in the invitation e-mail" >&2; exit 1; }
EXPIRED_URL="$(accept_link "$EXPIRED_INVITEE")" || { echo "smoke: no accept link in the e-mail (expired)" >&2; exit 1; }
REVOKED_URL="$(accept_link "$REVOKED_INVITEE")" || { echo "smoke: no accept link in the e-mail (revoked)" >&2; exit 1; }
[[ "$ACCEPT_URL" == http://localhost:3200/ar/invite/accept[?#]token=* ]] ||
  { echo "smoke: the accept link must use APP_BASE_URL and the invitation's language (ar)" >&2; exit 1; }
# Once a link has been sent, an operator ends one (support: expires_at) and revokes the other.
[[ "$(q "with u as (update platform.invitations set expires_at = now() - interval '1 minute' where email = '$EXPIRED_INVITEE' and status = 'pending' returning 1) select count(*) from u")" == "1" ]] ||
  { echo "smoke: could not expire the invitation" >&2; exit 1; }
[[ "$(q "with u as (update platform.invitations set status = 'revoked' where email = '$REVOKED_INVITEE' and status = 'pending' returning 1) select count(*) from u")" == "1" ]] ||
  { echo "smoke: could not revoke the invitation" >&2; exit 1; }

echo "smoke: the sign-up gate (T-M2-07, review H1) — Auth's public sign-up admits only a valid invitation for that e-mail"
# signup <JSON body>: the HTTP status of a public sign-up through the TLS gateway, as any client could
# send it (sign-ups are open; the before-user-created hook is the gate). Never echo the bodies (tokens).
# Self-hosted Auth needs a (non-secret) apikey header; kept in a variable for the secret scanner.
AUTH_APIKEY_HEADER='apikey: self-hosted'
signup() {
  curl -s -o /dev/null -w '%{http_code}' --cacert .secrets/ca.crt -X POST \
    -H 'Content-Type: application/json' -H "$AUTH_APIKEY_HEADER" --data-binary "$1" \
    https://localhost:8443/auth/v1/signup
}
# refused_by_hook <JSON body>: true when Auth answers 403 with the hook's EXACT refusal message — the
# same assertion as the staging uptime probe (.github/workflows/uptime.yml, re-review N4): any other 403
# would not prove that the sign-up gate answered.
refused_by_hook() {
  local response
  response="$(curl -s -w '\n%{http_code}' --cacert .secrets/ca.crt -X POST \
    -H 'Content-Type: application/json' -H "$AUTH_APIKEY_HEADER" --data-binary "$1" \
    https://localhost:8443/auth/v1/signup)"
  [[ "${response##*$'\n'}" == "403" ]] &&
    [[ "$(node -e 'try { const j = JSON.parse(process.argv[1]); process.stdout.write(String(j.msg ?? j.message ?? "")); } catch {}' \
      "${response%$'\n'*}")" == "Sign-up is by invitation only." ]]
}
ACCEPT_TOKEN="${ACCEPT_URL#*token=}"
INTRUDER_EMAIL="intruder-$STAMP@sovereign.example"
INTRUDER_PASSWORD="Intruder-$(openssl rand -hex 16)"
users_before="$(q "select count(*) from auth.users")"
# The two uptime probes: no invitation; a well-formed (43 base64url characters) but unknown token.
refused_by_hook "{\"email\":\"uptime-probe-$(openssl rand -hex 8)@lms.entlaqa.com\",\"password\":\"$INTRUDER_PASSWORD\",\"data\":{}}" ||
  { echo "smoke: a sign-up without an invitation must be refused by the hook (403, its message)" >&2; exit 1; }
UNKNOWN_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
[[ ${#UNKNOWN_TOKEN} -eq 43 ]] || { echo "smoke: could not build a 43-character token" >&2; exit 1; }
refused_by_hook "{\"email\":\"uptime-probe-$(openssl rand -hex 8)@lms.entlaqa.com\",\"password\":\"$INTRUDER_PASSWORD\",\"data\":{\"invitation\":\"$UNKNOWN_TOKEN\"}}" ||
  { echo "smoke: a sign-up with an unknown invitation token must be refused by the hook (403, its message)" >&2; exit 1; }
refused_by_hook "{\"email\":\"$INTRUDER_EMAIL\",\"password\":\"$INTRUDER_PASSWORD\"}" ||
  { echo "smoke: a sign-up without an invitation must be refused by the hook (403, its message)" >&2; exit 1; }
status="$(signup "{\"email\":\"$INTRUDER_EMAIL\",\"password\":\"$INTRUDER_PASSWORD\",\"data\":{\"invitation\":\"$ACCEPT_TOKEN\"}}")"
[[ "$status" == "403" ]] ||
  { echo "smoke: a sign-up with another person's valid invitation must be refused with 403 (got $status)" >&2; exit 1; }
for pair in "$EXPIRED_INVITEE ${EXPIRED_URL#*token=}" "$REVOKED_INVITEE ${REVOKED_URL#*token=}"; do
  status="$(signup "{\"email\":\"${pair%% *}\",\"password\":\"$INTRUDER_PASSWORD\",\"data\":{\"invitation\":\"${pair#* }\"}}")"
  [[ "$status" == "403" ]] ||
    { echo "smoke: a sign-up with an expired or revoked invitation must be refused with 403 (got $status)" >&2; exit 1; }
done
# The stored hash is not a token: only the raw e-mailed token opens the gate.
status="$(signup "{\"email\":\"$INVITEE_EMAIL\",\"password\":\"$INTRUDER_PASSWORD\",\"data\":{\"invitation\":\"$(q "select encode(token_hash, 'hex') from platform.invitations where email = '$INVITEE_EMAIL'")\"}}")"
[[ "$status" == "403" ]] || { echo "smoke: a sign-up with the token hash must be refused with 403 (got $status)" >&2; exit 1; }
# Anonymous sign-ins are off (and the hook would refuse them).
status="$(signup '{}')"
[[ "$status" =~ ^4[0-9][0-9]$ ]] || { echo "smoke: an anonymous sign-in must be refused (got $status)" >&2; exit 1; }
[[ "$(q "select count(*) from auth.users")" == "$users_before" ]] ||
  { echo "smoke: a refused sign-up created an Auth user" >&2; exit 1; }

(cd "$ROOT/apps/suite" && E2E_BASE_URL=http://localhost:3200 INVITE_E2E_ACCEPT_URL="$ACCEPT_URL" \
  INVITE_E2E_EXPIRED_URL="$EXPIRED_URL" INVITE_E2E_REVOKED_URL="$REVOKED_URL" \
  pnpm exec playwright test e2e/invite-accept.spec.ts --project=desktop-chromium)
# The database after acceptance: a confirmed Auth user with the invitation's e-mail, an active membership
# with the invited roles, the invitation accepted (single use), audited and announced.
INVITATION_ID="$(q "select id from platform.invitations where email = '$INVITEE_EMAIL'")"
inv="from platform.invitations i"
this="i.id = '$INVITATION_ID'"
[[ "$(q "select count(*) $inv where $this and i.status = 'accepted' and i.accepted_at is not null and exists (select 1 from auth.users u where u.id = i.accepted_user_id and u.email = i.email and u.email_confirmed_at is not null)")" == "1" ]] ||
  { echo "smoke: the invitation was not accepted by a confirmed account with its e-mail" >&2; exit 1; }
# The account was created by the hook-gated public sign-up, and the raw token it carried in its user
# metadata was removed again after acceptance.
[[ "$(q "select count(*) $inv join auth.users u on u.id = i.accepted_user_id where $this and u.raw_user_meta_data is not null and not (u.raw_user_meta_data ? 'invitation')")" == "1" ]] ||
  { echo "smoke: the accepted account still carries the invitation token in its user metadata" >&2; exit 1; }
[[ "$(q "select count(*) $inv join auth.users u on u.id = i.accepted_user_id where $this and u.raw_app_meta_data ->> 'provider' = 'email'")" == "1" ]] ||
  { echo "smoke: the accepted account must come from an e-mail sign-up" >&2; exit 1; }
[[ "$(q "select count(*) $inv join platform.tenant_memberships m on m.tenant_id = i.tenant_id and m.person_id = i.person_id and m.user_id = i.accepted_user_id where $this and m.status = 'active'")" == "1" ]] ||
  { echo "smoke: the accepted invitation did not create an active membership" >&2; exit 1; }
[[ "$(q "select string_agg(r.role_code || ':' || r.is_primary, ',' order by r.role_code) $inv join platform.tenant_memberships m on m.tenant_id = i.tenant_id and m.user_id = i.accepted_user_id join platform.role_assignments r on r.tenant_id = m.tenant_id and r.membership_id = m.id where $this")" == "learner:true,line_manager:false" ]] ||
  { echo "smoke: the accepted invitation did not assign the invited roles" >&2; exit 1; }
[[ "$(q "select count(*) $inv join platform.audit_events a on a.tenant_id = i.tenant_id and a.entity_id = i.id::text where $this and a.action in ('platform.invitation.created', 'platform.invitation.accepted') and (a.action <> 'platform.invitation.accepted' or a.actor_user_id = i.accepted_user_id)")" == "2" ]] ||
  { echo "smoke: expected the created and accepted audit events of the invitation" >&2; exit 1; }
[[ "$(q "select count(*) $inv join platform.event_outbox e on e.tenant_id = i.tenant_id and e.subject = i.id where $this and e.type = 'com.entlaqa.platform.invitation.accepted'")" == "1" ]] ||
  { echo "smoke: expected the invitation.accepted domain event" >&2; exit 1; }
# Every invitation e-mail is sent and its delivery row keeps no content (address, subject, bodies).
for i in $(seq 1 30); do
  [[ "$(q "select count(*) from platform.message_deliveries where template = 'platform.invitation' and status <> 'sent'")" == "0" ]] && break
  [[ $i -eq 30 ]] && { echo "smoke: an invitation e-mail delivery did not reach the 'sent' status" >&2; exit 1; }
  sleep 1
done
[[ "$(q "select count(*) $inv join platform.message_deliveries d on d.tenant_id = i.tenant_id and d.recipient_person_id = i.person_id where $this and d.template = 'platform.invitation' and d.status = 'sent' and d.sent_at is not null and d.destination is null and d.subject is null and d.html_body is null and d.text_body is null")" == "1" ]] ||
  { echo "smoke: expected one sent invitation delivery without content" >&2; exit 1; }
# The tokens (credentials) appear nowhere but the e-mails: not in the audit trail or any container log.
INVITE_TOKENS=("${ACCEPT_URL#*token=}" "${EXPIRED_URL#*token=}" "${REVOKED_URL#*token=}")
for token in "${INVITE_TOKENS[@]}"; do
  [[ "$(q "select count(*) from platform.audit_events where data::text like '%$token%'")" == "0" ]] ||
    { echo "smoke: an invitation token reached the audit log" >&2; exit 1; }
done

echo "smoke: no e-mail change through Auth (re-review N1) — a signed-in account cannot take another address"
# auth_api <method> <path> <bearer token or empty> <JSON body>: "<HTTP status>\n<body>" through the gateway.
auth_api() {
  curl -s -w '\n%{http_code}' --cacert .secrets/ca.crt -X "$1" -H 'Content-Type: application/json' \
    -H "$AUTH_APIKEY_HEADER" ${3:+-H "Authorization: Bearer $3"} --data-binary "$4" "https://localhost:8443/auth/v1$2"
}
json_field() { node -e 'try { process.stdout.write(String(JSON.parse(process.argv[1])[process.argv[2]] ?? "")); } catch {}' "$1" "$2"; }
GUARD_EMAIL="guard-$STAMP@sovereign.example"
GUARD_PASSWORD="Guard-$(openssl rand -hex 16)"
GUARD_ID="$(create_user "$GUARD_EMAIL" "$GUARD_PASSWORD")"
response="$(auth_api POST '/token?grant_type=password' '' "{\"email\":\"$GUARD_EMAIL\",\"password\":\"$GUARD_PASSWORD\"}")"
[[ "${response##*$'\n'}" == "200" ]] || { echo "smoke: the guard test user could not sign in" >&2; exit 1; }
GUARD_TOKEN="$(json_field "${response%$'\n'*}" access_token)"
GUARD_REFRESH="$(json_field "${response%$'\n'*}" refresh_token)"
# The address of another (future) invitee: PUT /user {"email"} must be refused and change nothing.
response="$(auth_api PUT /user "$GUARD_TOKEN" "{\"email\":\"squat-$STAMP@sovereign.example\"}")"
[[ "${response##*$'\n'}" =~ ^[45][0-9][0-9]$ ]] ||
  { echo "smoke: Auth accepted an e-mail change request (HTTP ${response##*$'\n'})" >&2; exit 1; }
[[ "$(q "select email || '|' || coalesce(email_change, '') from auth.users where id = '$GUARD_ID'")" == "$GUARD_EMAIL|" ]] ||
  { echo "smoke: the account's e-mail or pending e-mail change was modified" >&2; exit 1; }
# Self-hosted Auth has no mail relay (T-M2-17), but hosted Auth could e-mail a confirmation link: the
# database guard itself must refuse the change for every role (the migration role too) — that is what
# protects hosted Auth.
guard_err="$(q "update auth.users set email = 'squat-$STAMP@sovereign.example' where id = '$GUARD_ID'" 2>&1 || true)"
[[ "$guard_err" == *"managed by the organization"* ]] ||
  { echo "smoke: the database did not refuse an Auth e-mail change (re-review N1)" >&2; exit 1; }
# Everything else Auth does still works with the guard installed: token refresh, password change.
response="$(auth_api POST '/token?grant_type=refresh_token' '' "{\"refresh_token\":\"$GUARD_REFRESH\"}")"
[[ "${response##*$'\n'}" == "200" ]] || { echo "smoke: token refresh failed with the e-mail guard installed" >&2; exit 1; }
GUARD_TOKEN="$(json_field "${response%$'\n'*}" access_token)"
GUARD_NEW_PASSWORD="Guard-$(openssl rand -hex 16)"
response="$(auth_api PUT /user "$GUARD_TOKEN" "{\"password\":\"$GUARD_NEW_PASSWORD\",\"current_password\":\"$GUARD_PASSWORD\"}")"
[[ "${response##*$'\n'}" == "200" ]] || { echo "smoke: password change failed with the e-mail guard installed" >&2; exit 1; }
response="$(auth_api POST '/token?grant_type=password' '' "{\"email\":\"$GUARD_EMAIL\",\"password\":\"$GUARD_NEW_PASSWORD\"}")"
[[ "${response##*$'\n'}" == "200" ]] || { echo "smoke: sign-in with the new password failed" >&2; exit 1; }
unset GUARD_TOKEN GUARD_REFRESH response

echo "smoke: My profile (T-M2-15a) — own details and password change as an ordinary member"
PROFILE_NEW_PASSWORD="Profile-$(openssl rand -hex 16)"
(cd "$ROOT/apps/suite" && E2E_BASE_URL=http://localhost:3200 SIGNED_IN_E2E_MANAGER_EMAIL="$MANAGER_EMAIL" \
  SIGNED_IN_E2E_MANAGER_PASSWORD="$MANAGER_PASSWORD" PROFILE_E2E_NEW_PASSWORD="$PROFILE_NEW_PASSWORD" \
  pnpm exec playwright test e2e/profile.spec.ts --project=desktop-chromium)
[[ "$(q "select count(distinct action) from platform.audit_events where action in ('platform.profile.updated', 'platform.auth.password_changed')")" == "2" ]] ||
  { echo "smoke: expected profile and password-change audit events" >&2; exit 1; }
# After the password change, every other sign-in session of the member ended (and the password-check
# sessions too): only the last sign-in with the new password remains.
[[ "$(q "select count(*) from auth.sessions where user_id = '$MANAGER_ID'")" == "1" ]] ||
  { echo "smoke: other sign-in sessions survived the password change" >&2; exit 1; }
# Our "password changed" notice (T-M2-17): queued by the profile action, sent by the worker in the
# member's organization (Auth's own notice is off).
# mail_count <address> <subject pattern>: Mailpit messages to <address> whose subject matches.
mail_count() {
  compose exec -T mailpit wget -qO- 'http://127.0.0.1:8025/api/v1/messages?limit=500' 2>/dev/null |
    node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let n = 0; try { for (const m of JSON.parse(s).messages ?? [])
        if ((m.To ?? []).some((t) => t.Address === process.argv[1]) && new RegExp(process.argv[2]).test(m.Subject ?? "")) n++; } catch {}
      process.stdout.write(String(n)); })' "$1" "$2"
}
for i in $(seq 1 30); do
  [[ "$(mail_count "$MANAGER_EMAIL" 'Your password was changed')" == "1" ]] && break
  [[ $i -eq 30 ]] && { echo "smoke: no (or more than one) password-changed notice after the My profile change" >&2; exit 1; }
  sleep 1
done
if [[ "$(q "select count(*) from platform.audit_events where data::text like '%منيرة%' or data::text like '%966551112233%'")" != "0" ]]; then
  echo "smoke: personal data reached the audit log" >&2; exit 1
fi

echo "smoke: password reset (T-M2-08, T-M2-17) — forgot page, our e-mail, new password; old password and link refused"
RESET_EMAIL="reset-$STAMP@sovereign.example"
RESET_OLD_PASSWORD="Reset-$(openssl rand -hex 16)"
RESET_NEW_PASSWORD="Reset-$(openssl rand -hex 16)"
RESET_ID="$(create_user "$RESET_EMAIL" "$RESET_OLD_PASSWORD")"
# The account must belong to an organization (the e-mail is sent in its language and brand); a person
# without membership gets none.
[[ "$(q "with p as (insert into platform.persons (tenant_id, display_name_ar, display_name_en, email)
            select id, 'مستخدمة الاستعادة', 'Reset User', '$RESET_EMAIL' from platform.tenants where slug = 'sovereign-smoke'
            returning tenant_id, id),
          m as (insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
            select tenant_id, '$RESET_ID', id, 'active' from p returning 1)
        select count(*) from m")" == "1" ]] || { echo "smoke: could not add the reset test user to the organization" >&2; exit 1; }
# Auth's admin API (security review T-M2-17, T-M2-09). From INSIDE a worker, with its own key and URL
# (gateway port 8444, network auth-admin): generate_link (GoTrue v2.197.0) answers — an unknown address
# gets Auth's 404 user_not_found and creates no user — and so does PUT /admin/users/{id} (account bans) for
# an unknown id; nothing else is served (no listing, creating, reading or deleting users, no factors).
# worker_admin <method> <path> [JSON body] → "<HTTP status> <Auth error_code or ->"; never the body.
worker_admin() {
  compose exec -T --index 1 worker /nodejs/bin/node -e '
    const [method, path, body] = process.argv.slice(1);
    const key = process.env.SUPABASE_SECRET_KEY;
    fetch(`${process.env.SUPABASE_URL}/auth/v1${path}`, { method, body: method === "GET" ? undefined : body || undefined,
      headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}` } })
      .then(async (r) => { let code = "-"; try { code = (await r.json()).error_code ?? "-"; } catch {}
        process.stdout.write(`${r.status} ${code}`); }, () => process.stdout.write("000 -"));' "$1" "$2" "${3:-}"
}
users_before="$(q "select count(*) from auth.users")"
[[ "$(worker_admin POST /admin/generate_link "{\"type\":\"recovery\",\"email\":\"nobody-$STAMP@sovereign.example\"}")" == "404 user_not_found" ]] ||
  { echo "smoke: the worker's generate_link for an unknown address must get Auth's 404 user_not_found" >&2; exit 1; }
# A ban for an id Auth does not have: through the gateway to Auth, which answers 404 and changes nothing.
[[ "$(worker_admin PUT /admin/users/00000000-0000-4000-8000-00000000dead '{"ban_duration":"none"}')" == "404 user_not_found" ]] ||
  { echo "smoke: the worker's account ban for an unknown id must get Auth's 404 user_not_found" >&2; exit 1; }
# One account by its lower-case id, PUT only: no other method, no sub-path, no other spelling of the id.
for call in "GET /admin/users" "POST /admin/users" "PUT /admin/users" "GET /admin/users/$RESET_ID" \
  "DELETE /admin/users/$RESET_ID" "POST /admin/users/$RESET_ID" "PATCH /admin/users/$RESET_ID" \
  "GET /admin/users/$RESET_ID/factors" "PUT /admin/users/$RESET_ID/factors" \
  "PUT /admin/users/${RESET_ID^^}" "PUT /admin/users/$RESET_ID/" "POST /invite" "GET /health"; do
  # shellcheck disable=SC2086 # method and path, split on purpose
  answer="$(worker_admin $call "{\"email\":\"worker-$STAMP@sovereign.example\",\"password\":\"Worker-$STAMP-not-used\"}")"
  [[ "$answer" == "403 -" || "$answer" == "404 -" ]] ||
    { echo "smoke: the gateway must refuse the worker's $call on the admin port (got $answer)" >&2; exit 1; }
done
[[ "$(q "select count(*) from auth.users")" == "$users_before" ]] ||
  { echo "smoke: the worker's admin calls created an Auth user" >&2; exit 1; }
# The published port 8443 serves no admin path — not even with a valid admin key (the worker's) — and the
# admin port 8444 is not published; the app (network edge) is refused there.
for call in "POST /admin/generate_link" "GET /admin/users" "POST /admin/users" "POST /invite"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --cacert .secrets/ca.crt -X "${call%% *}" \
    -H 'Content-Type: application/json' -H "$AUTH_APIKEY_HEADER" -H "Authorization: Bearer $(secret WORKER_AUTH_ADMIN_TOKEN)" \
    --data-binary "{\"type\":\"recovery\",\"email\":\"$RESET_EMAIL\"}" "https://localhost:8443/auth/v1${call#* }")"
  [[ "$code" == "404" ]] || { echo "smoke: the published gateway port must refuse $call (got $code)" >&2; exit 1; }
done
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --cacert .secrets/ca.crt -X POST \
  https://localhost:8444/auth/v1/admin/generate_link || true)"
[[ "$code" == "000" ]] || { echo "smoke: the gateway's admin port must not be published (got $code)" >&2; exit 1; }
code="$(compose exec -T app /nodejs/bin/node -e \
  'fetch(process.argv[1], { method: "POST" }).then((r) => process.stdout.write(String(r.status)), () => process.stdout.write("000"))' \
  https://gateway:8444/auth/v1/admin/generate_link)"
[[ "$code" == "403" ]] || { echo "smoke: the gateway's admin port must refuse the app (got $code)" >&2; exit 1; }
# Nor does the host reach it through a bridge: every gateway address refuses (403) or does not answer.
for address in $($DOCKER inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$(compose ps -q gateway)"); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --cacert .secrets/ca.crt --resolve "gateway:8444:$address" \
    -X POST https://gateway:8444/auth/v1/admin/generate_link || true)"
  [[ "$code" == "403" || "$code" == "000" ]] ||
    { echo "smoke: the host reached the gateway's admin port at $address (got $code)" >&2; exit 1; }
done
# Auth itself sends nothing (it has no mail relay), and its public endpoints that would issue recovery
# tokens are closed at the gateway.
for path in /recover /otp /magiclink /resend; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --cacert .secrets/ca.crt -X POST -H 'Content-Type: application/json' \
    -H "$AUTH_APIKEY_HEADER" --data-binary "{\"email\":\"$RESET_EMAIL\"}" "https://localhost:8443/auth/v1$path")"
  [[ "$code" == "404" ]] || { echo "smoke: the gateway must refuse /auth/v1$path (got $code)" >&2; exit 1; }
done
[[ "$(q "select count(*) from auth.users where id = '$RESET_ID' and recovery_sent_at is not null")" == "0" ]] ||
  { echo "smoke: a recovery token was issued before the reset was requested" >&2; exit 1; }
# A sign-in session that the reset must end (every session of the account ends: signOut global).
response="$(auth_api POST '/token?grant_type=password' '' "{\"email\":\"$RESET_EMAIL\",\"password\":\"$RESET_OLD_PASSWORD\"}")"
[[ "${response##*$'\n'}" == "200" ]] || { echo "smoke: the reset test user could not sign in" >&2; exit 1; }
unset response
# Step 1: request a link through the forgot page (Arabic), and the same answer for an unknown address.
(cd "$ROOT/apps/suite" && E2E_BASE_URL=http://localhost:3200 RESET_E2E_EMAIL="$RESET_EMAIL" \
  pnpm exec playwright test e2e/password-reset.spec.ts --project=desktop-chromium)
# reset_link <address>: the reset link in the newest reset e-mail to <address> — OUR e-mail (worker,
# notification service, T-M2-17): HTML and text parts, the organization's name, Arabic first (the
# person's language) with the English page below. Whole and unchanged: the token travels in the fragment.
# The e-mail must carry neither the one-time code path (/verify) nor anything but our page. Never echo it.
reset_link() {
  local id
  id="$(compose exec -T mailpit wget -qO- 'http://127.0.0.1:8025/api/v1/messages?limit=500' 2>/dev/null |
    node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { for (const m of JSON.parse(s).messages ?? [])
        if ((m.To ?? []).some((t) => t.Address === process.argv[1]) && /Reset your password/.test(m.Subject ?? ""))
          { console.log(m.ID); break; } } catch {} })' "$1")"
  [[ -n "$id" ]] || return 1
  compose exec -T mailpit wget -qO- "http://127.0.0.1:8025/api/v1/message/$id" 2>/dev/null |
    node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let m = {}; try { m = JSON.parse(s); } catch {}
      const html = (m.HTML ?? "").replace(/&amp;/g, "&"), text = m.Text ?? "";
      if (/\/verify|token=/.test(html + text)) process.exit(2);
      if (!html.includes("منشأة الاختبار السيادي") || !/^<!doctype html>\s*<html lang="ar" dir="rtl">/.test(html)) process.exit(3);
      const re = /http:\/\/localhost:3200\/ar\/reset-password#token_hash=[A-Za-z0-9_-]{16,128}&type=recovery(?![A-Za-z0-9_-])/;
      const link = html.match(re), inText = text.match(re);
      const en = link && link[0].replace("/ar/", "/en/");
      if (!link || !inText || inText[0] !== link[0] || !html.includes(en) || !text.includes(en)) process.exit(1);
      process.stdout.write(link[0]); })'
}
RESET_URL=""
for i in $(seq 1 30); do
  RESET_URL="$(reset_link "$RESET_EMAIL")" && break
  [[ $i -eq 30 ]] && { echo "smoke: no reset link (our e-mail, fragment only) from the worker" >&2; exit 1; }
  sleep 1
done
# Exactly one reset e-mail, and every request answered: the unknown address of the spec got none, and
# nothing waits in the account e-mail queue.
[[ "$(mail_count "$RESET_EMAIL" 'Reset your password')" == "1" ]] ||
  { echo "smoke: expected exactly one reset e-mail" >&2; exit 1; }
for i in $(seq 1 30); do
  [[ "$(q "select count(*) from private.account_mail_requests")" == "0" ]] && break
  [[ $i -eq 30 ]] && { echo "smoke: account e-mail requests were left unanswered" >&2; exit 1; }
  sleep 1
done
# The link's token waits in Auth (generate_link set recovery_token, GoTrue v2.197.0); the database sees
# only that one waits (private.auth_account.recovery_pending), never the token.
[[ "$(q "select recovery_pending from private.auth_account where id = '$RESET_ID'")" == "t" ]] ||
  { echo "smoke: after generate_link a recovery token must wait (recovery_pending)" >&2; exit 1; }
# Step 2: set the new password from the link; a second use of the link is refused (in the spec).
(cd "$ROOT/apps/suite" && E2E_BASE_URL=http://localhost:3200 RESET_E2E_LINK_URL="$RESET_URL" \
  RESET_E2E_NEW_PASSWORD="$RESET_NEW_PASSWORD" \
  pnpm exec playwright test e2e/password-reset.spec.ts --project=desktop-chromium)
# Every session of the account ended (the earlier sign-in and the recovery session).
[[ "$(q "select count(*) from auth.sessions where user_id = '$RESET_ID'")" == "0" ]] ||
  { echo "smoke: sign-in sessions survived the password reset" >&2; exit 1; }
response="$(auth_api POST '/token?grant_type=password' '' "{\"email\":\"$RESET_EMAIL\",\"password\":\"$RESET_NEW_PASSWORD\"}")"
[[ "${response##*$'\n'}" == "200" ]] || { echo "smoke: sign-in with the new password failed" >&2; exit 1; }
response="$(auth_api POST '/token?grant_type=password' '' "{\"email\":\"$RESET_EMAIL\",\"password\":\"$RESET_OLD_PASSWORD\"}")"
[[ "${response##*$'\n'}" =~ ^4[0-9][0-9]$ ]] || { echo "smoke: the old password still signs in" >&2; exit 1; }
unset response
# The account owner got our "password changed" notice (worker, T-M2-17) — one, not Auth's as well.
for i in $(seq 1 30); do
  [[ "$(mail_count "$RESET_EMAIL" 'Your password was changed')" == "1" ]] && break
  [[ $i -eq 30 ]] && { echo "smoke: no (or more than one) password-changed notice after the reset" >&2; exit 1; }
  sleep 1
done
# The link was used: Auth cleared the token (verify, then the password change), so the notice was queued.
[[ "$(q "select recovery_pending from private.auth_account where id = '$RESET_ID'")" == "f" ]] ||
  { echo "smoke: after the reset no recovery token may wait (recovery_pending)" >&2; exit 1; }
# Both e-mails are in the organization's delivery log, sent, without content or address.
[[ "$(q "select count(*) from platform.message_deliveries d join platform.persons p on p.tenant_id = d.tenant_id and p.id = d.recipient_person_id
        where p.email = '$RESET_EMAIL' and d.template in ('platform.password_reset', 'platform.password_changed')
          and d.status = 'sent' and d.destination is null and d.html_body is null and d.text_body is null")" == "2" ]] ||
  { echo "smoke: expected the reset e-mail and the notice as sent deliveries without content" >&2; exit 1; }
# A reset that was triggered but never used blocks the notice (security re-verification): another member
# gets our reset e-mail (requested as the web app does it, through the database as app_server); a
# claim-less "password changed" request — what a stolen app_server credential could send — is then
# dropped, because the link's token still waits.
q_app_server() {
  PGPASSWORD="$(secret APP_SERVER_DB_PASSWORD)" PGSSLMODE=verify-full PGSSLROOTCERT=.secrets/ca.crt \
    psql -h localhost -p 55432 -U app_server -d postgres -X -At -v ON_ERROR_STOP=1 -c "$1"
}
UNUSED_EMAIL="unused-$STAMP@sovereign.example"
UNUSED_ID="$(create_user "$UNUSED_EMAIL" "Unused-$(openssl rand -hex 16)")"
[[ "$(q "with p as (insert into platform.persons (tenant_id, display_name_ar, display_name_en, email)
            select id, 'رابط غير مستخدم', 'Unused Link', '$UNUSED_EMAIL' from platform.tenants where slug = 'sovereign-smoke'
            returning tenant_id, id),
          m as (insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
            select tenant_id, '$UNUSED_ID', id, 'active' from p returning 1)
        select count(*) from m")" == "1" ]] || { echo "smoke: could not add the unused-link user to the organization" >&2; exit 1; }
q_app_server "begin; set local role authenticated; select private.request_password_reset_mail('$UNUSED_EMAIL'); commit" >/dev/null
for i in $(seq 1 30); do
  [[ "$(mail_count "$UNUSED_EMAIL" 'Reset your password')" == "1" ]] && break
  [[ $i -eq 30 ]] && { echo "smoke: the unused-link user's reset e-mail did not arrive" >&2; exit 1; }
  sleep 1
done
[[ "$(q "select recovery_pending from private.auth_account where id = '$UNUSED_ID'")" == "t" ]] ||
  { echo "smoke: after generate_link a recovery token must wait (recovery_pending, second account)" >&2; exit 1; }
q_app_server "begin; set local role authenticated; select private.request_password_changed_mail('$UNUSED_ID'); commit" >/dev/null
[[ "$(q "select count(*) from private.account_mail_requests where user_id = '$UNUSED_ID'")" == "0" ]] ||
  { echo "smoke: a password-changed notice was queued although the reset link was never used" >&2; exit 1; }
# The token (a credential) appears nowhere but the e-mail: not in any container log or the audit trail.
RESET_TOKEN="${RESET_URL#*token_hash=}"
RESET_TOKEN="${RESET_TOKEN%%&*}"
if compose logs --no-log-prefix app worker 2>&1 | grep -qF "$RESET_TOKEN"; then
  echo "smoke: the reset token appears in the app or worker logs" >&2; exit 1
fi
[[ "$(q "select count(*) from platform.audit_events where data::text like '%$RESET_TOKEN%'")" == "0" ]] ||
  { echo "smoke: the reset token reached the audit log" >&2; exit 1; }
unset RESET_URL RESET_TOKEN
# The gateway limits Auth's /verify per source address (30 a minute, burst 10) — also with a trailing
# slash, which Auth's router serves too (security review M). Beyond the burst: 429. Nothing else calls
# /verify from this host's address (the app has its own).
for path in /verify/ /verify; do
  limited=0
  for i in $(seq 1 15); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --cacert .secrets/ca.crt -H "$AUTH_APIKEY_HEADER" \
      "https://localhost:8443/auth/v1$path?type=recovery&token_hash=0000000000000000")"
    [[ "$code" == "429" ]] && { limited=1; break; }
  done
  [[ $limited -eq 1 ]] || { echo "smoke: the gateway does not limit /auth/v1$path beyond its burst" >&2; exit 1; }
done

echo "smoke: deactivate and reactivate members (T-M2-09) — reassignment, sessions end, the worker's Auth ban"
DEACT_EMAIL="deactivate-$STAMP@sovereign.example"
DEACT_PASSWORD="Deactivate-$(openssl rand -hex 16)"
DEACT_ID="$(create_user "$DEACT_EMAIL" "$DEACT_PASSWORD")"
SECOND_EMAIL="deactivate-second-$STAMP@sovereign.example"
SECOND_ID="$(create_user "$SECOND_EMAIL" "Second-$(openssl rand -hex 16)")"
PGPASSWORD="$POSTGRES_PASSWORD" PGSSLMODE=verify-full PGSSLROOTCERT=.secrets/ca.crt \
  psql -h localhost -p 55432 -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -v admin_user="$USER_ID" \
  -v deact_user="$DEACT_ID" -v deact_email="$DEACT_EMAIL" -v second_user="$SECOND_ID" \
  -v second_email="$SECOND_EMAIL" -f seed-deactivation.sql >/dev/null
DEACT_PERSON=5eed1000-0000-4000-8000-0000000000d1
SECOND_PERSON=5eed1000-0000-4000-8000-0000000000d2
# An Auth session of Reem outside the browser: after the ban its refresh token must stop working.
response="$(auth_api POST '/token?grant_type=password' '' "{\"email\":\"$DEACT_EMAIL\",\"password\":\"$DEACT_PASSWORD\"}")"
[[ "${response##*$'\n'}" == "200" ]] || { echo "smoke: the member to deactivate could not sign in" >&2; exit 1; }
DEACT_REFRESH="$(json_field "${response%$'\n'*}" refresh_token)"
unset response
[[ -n "$DEACT_REFRESH" ]] || { echo "smoke: no refresh token for the member to deactivate" >&2; exit 1; }
# deactivate_e2e <phase>: the browser journey of deactivate.spec.ts for one phase (Mona's password is the one
# she set in the My profile journey).
deactivate_e2e() {
  (cd "$ROOT/apps/suite" && E2E_BASE_URL=http://localhost:3200 DEACTIVATE_E2E_PHASE="$1" \
    SIGNED_IN_E2E_EMAIL="$EMAIL" SIGNED_IN_E2E_PASSWORD="$PASSWORD" \
    SIGNED_IN_E2E_MANAGER_EMAIL="$MANAGER_EMAIL" SIGNED_IN_E2E_MANAGER_PASSWORD="$PROFILE_NEW_PASSWORD" \
    DEACTIVATE_E2E_MEMBER_EMAIL="$DEACT_EMAIL" DEACTIVATE_E2E_MEMBER_PASSWORD="$DEACT_PASSWORD" \
    pnpm exec playwright test e2e/deactivate.spec.ts --project=desktop-chromium)
}
deactivate_e2e deactivate
# The database after the deactivations: memberships suspended, people inactive, records and roles kept;
# Reem's report and department handed over to Mona; her sessions in the organization ended.
[[ "$(q "select count(*) from platform.tenant_memberships m join platform.persons p on p.tenant_id = m.tenant_id and p.id = m.person_id
        where m.user_id in ('$DEACT_ID', '$SECOND_ID') and m.status = 'suspended' and p.status = 'inactive'")" == "2" ]] ||
  { echo "smoke: expected both members deactivated (membership suspended, person inactive)" >&2; exit 1; }
[[ "$(q "select count(*) from platform.role_assignments ra join platform.tenant_memberships m on m.id = ra.membership_id
        where m.user_id = '$DEACT_ID' and ra.role_code in ('line_manager', 'learner')")" == "2" ]] ||
  { echo "smoke: a deactivated member's roles must be kept" >&2; exit 1; }
[[ "$(q "select count(*) from platform.person_employment e join platform.departments d on d.tenant_id = e.tenant_id
        where e.person_id = '5eed1000-0000-4000-8000-0000000000d3' and e.manager_person_id = '5eed1000-0000-4000-8000-000000000003'
          and d.code = 'QLT' and d.head_person_id = '5eed1000-0000-4000-8000-000000000003'")" == "1" ]] ||
  { echo "smoke: the direct report and the department were not handed over to the chosen person" >&2; exit 1; }
[[ "$(q "select count(*) from platform.session_context c join platform.tenants t on t.id = c.active_tenant_id
        where c.user_id = '$DEACT_ID' and t.slug = 'sovereign-smoke'")" == "0" ]] ||
  { echo "smoke: the deactivated member's sessions in the organization did not end" >&2; exit 1; }
# Audited with changed facts only (ids and codes: reason, what moved to whom) and announced as events.
[[ "$(q "select count(*) from platform.audit_events where action = 'platform.user.deactivated'
        and entity_id in ('$DEACT_PERSON', '$SECOND_PERSON') and data ? 'membershipId' and data ? 'reassigned'")" == "2" ]] ||
  { echo "smoke: expected two deactivation audit events" >&2; exit 1; }
[[ "$(q "select count(*) from platform.audit_events where action = 'platform.user.deactivated' and entity_id = '$DEACT_PERSON'
        and data ->> 'reason' = 'long_leave' and jsonb_array_length(data -> 'reassigned') = 2")" == "1" ]] ||
  { echo "smoke: the deactivation audit event must carry the reason and both hand-overs" >&2; exit 1; }
[[ "$(q "select count(*) from platform.event_outbox where type = 'com.entlaqa.platform.user.deactivated'")" == "2" ]] ||
  { echo "smoke: expected two user.deactivated events" >&2; exit 1; }
if [[ "$(q "select count(*) from platform.audit_events a where a.action like 'platform.user.%activated'
           and (a.data::text like '%@%' or a.data::text like '%Reem%' or a.data::text like '%ريم%' or a.data::text like '%EMP-41%')")" != "0" ]]; then
  echo "smoke: personal data reached the deactivation audit events" >&2; exit 1
fi
# The worker bans both accounts in Auth (they sign in nowhere now) through the gateway's admin port.
for i in $(seq 1 60); do
  [[ "$(q "select count(*) from auth.users u join private.account_bans b on b.user_id = u.id
          where u.id in ('$DEACT_ID', '$SECOND_ID') and u.banned_until > now() + interval '50 years'")" == "2" ]] && break
  [[ $i -eq 60 ]] && { echo "smoke: the worker did not ban the deactivated accounts in Auth" >&2; exit 1; }
  sleep 1
done
[[ "$(q "select count(*) from private.account_access_checks")" == "0" ]] ||
  { echo "smoke: account access checks were left unanswered" >&2; exit 1; }
# Auth refuses the banned account: sign-in and token refresh. (The web app answers every refused
# sign-in alike; Auth's own answer says user_banned — recorded, not asserted, for the security review.)
response="$(auth_api POST '/token?grant_type=password' '' "{\"email\":\"$DEACT_EMAIL\",\"password\":\"$DEACT_PASSWORD\"}")"
[[ "${response##*$'\n'}" =~ ^4[0-9][0-9]$ ]] || { echo "smoke: Auth still signs in the banned account" >&2; exit 1; }
echo "smoke: Auth answers a banned account's sign-in with $(json_field "${response%$'\n'*}" error_code) (HTTP ${response##*$'\n'})"
response="$(auth_api POST '/token?grant_type=password' '' "{\"email\":\"$DEACT_EMAIL\",\"password\":\"Wrong-$STAMP-password\"}")"
echo "smoke: …and with a wrong password: $(json_field "${response%$'\n'*}" error_code) (HTTP ${response##*$'\n'})"
response="$(auth_api POST '/token?grant_type=refresh_token' '' "{\"refresh_token\":\"$DEACT_REFRESH\"}")"
[[ "${response##*$'\n'}" =~ ^4[0-9][0-9]$ ]] || { echo "smoke: Auth still refreshes the banned account's session" >&2; exit 1; }
unset response
# Reactivation: the bans are lifted and the member signs in again, with the same roles.
deactivate_e2e reactivate
[[ "$(q "select count(*) from platform.tenant_memberships m join platform.persons p on p.tenant_id = m.tenant_id and p.id = m.person_id
        where m.user_id in ('$DEACT_ID', '$SECOND_ID') and m.status = 'active' and p.status = 'active'")" == "2" ]] ||
  { echo "smoke: expected both members active again" >&2; exit 1; }
[[ "$(q "select count(*) from platform.audit_events where action = 'platform.user.reactivated' and entity_id in ('$DEACT_PERSON', '$SECOND_PERSON')")" == "2" &&
   "$(q "select count(*) from platform.event_outbox where type = 'com.entlaqa.platform.user.reactivated'")" == "2" ]] ||
  { echo "smoke: expected two reactivation audit events and events" >&2; exit 1; }
for i in $(seq 1 60); do
  [[ "$(q "select count(*) from auth.users u where u.id in ('$DEACT_ID', '$SECOND_ID') and (u.banned_until is null or u.banned_until <= now())
          and not exists (select 1 from private.account_bans b where b.user_id = u.id)")" == "2" ]] && break
  [[ $i -eq 60 ]] && { echo "smoke: the worker did not lift the bans of the reactivated accounts" >&2; exit 1; }
  sleep 1
done
deactivate_e2e returns
[[ "$(q "select count(*) from platform.role_assignments ra join platform.tenant_memberships m on m.id = ra.membership_id
        where m.user_id = '$DEACT_ID' and ra.role_code in ('line_manager', 'learner')")" == "2" ]] ||
  { echo "smoke: the reactivated member's roles changed" >&2; exit 1; }
# The worker logged what it did, never an account id or address. (Logs captured first: `grep -q` stops
# reading early, which fails the pipe under pipefail.)
worker_logs="$(compose logs --no-log-prefix worker 2>&1)"
if grep -qE "$DEACT_ID|$SECOND_ID" <<<"$worker_logs"; then
  echo "smoke: an account id appears in the worker logs" >&2; exit 1
fi
grep -q 'account access: banned' <<<"$worker_logs" && grep -q 'account access: unbanned' <<<"$worker_logs" ||
  { echo "smoke: the worker did not log its account bans and their lifting" >&2; exit 1; }
unset worker_logs

# No unconfirmed e-mail account exists after every journey (re-review N3): with "Confirm email" off, Auth
# would hand a session for such an account to anyone who signs up with its e-mail, without the hook.
# Accounts as Auth looks them up for a sign-up (GoTrue FindUserByEmailAndAudience); the sample people of
# seed-users.sql are bare rows Auth does not find (no instance_id: a sign-up for them reaches the hook).
[[ "$(q "select count(*) from auth.users where instance_id = '00000000-0000-0000-0000-000000000000' and aud = 'authenticated' and not is_sso_user and email is not null and email_confirmed_at is null")" == "0" ]] ||
  { echo "smoke: an unconfirmed Auth account exists (sign-up would take it over)" >&2; exit 1; }

echo "smoke: checking secrets stay out of the logs and Auth is reachable only through the gateway"
if compose logs db auth 2>&1 | grep -qF "$(secret AUTH_DB_PASSWORD)"; then
  echo "smoke: the Auth database password appears in the container logs" >&2; exit 1
fi
# No personal data in operational logs (ADR 0009 §2, verification 1), after the sign-in journeys: the
# test users' passwords must appear in no container's logs; their e-mail addresses — or any e-mail
# address — must not appear in the app's logs. (Supabase Auth itself records the e-mail of a sign-in in
# its own logs; that is third-party behaviour, covered by the log retention/access rules of ADR 0009.)
all_logs="$(compose logs --no-log-prefix 2>&1)"
app_logs="$(compose logs --no-log-prefix app 2>&1)"
for value in "$PASSWORD" "$PARITY_PASSWORD" "$MANAGER_PASSWORD" "$PROFILE_NEW_PASSWORD" "$INTRUDER_PASSWORD" \
  "$GUARD_PASSWORD" "$GUARD_NEW_PASSWORD" "$RESET_OLD_PASSWORD" "$RESET_NEW_PASSWORD" "$DEACT_PASSWORD"; do
  if grep -qF "$value" <<<"$all_logs"; then
    echo "smoke: a test user's password appears in the container logs" >&2; exit 1
  fi
done
for value in "$EMAIL" "$PARITY_EMAIL" "$MANAGER_EMAIL" "$RESET_EMAIL" "$DEACT_EMAIL" "$SECOND_EMAIL"; do
  if grep -qF "$value" <<<"$app_logs"; then
    echo "smoke: a test user's e-mail address appears in the app logs" >&2; exit 1
  fi
done
if grep -qE '[[:alnum:]._%+-]+@[[:alnum:]-]+(\.[[:alnum:]-]+)*\.[[:alpha:]]{2,}' <<<"$app_logs"; then
  echo "smoke: an e-mail address appears in the app logs" >&2; exit 1
fi
# The worker handled every address of the journeys (invitations, resets, notices): it logs none.
if compose logs --no-log-prefix worker 2>&1 |
  grep -qE '[[:alnum:]._%+-]+@[[:alnum:]-]+(\.[[:alnum:]-]+)*\.[[:alpha:]]{2,}'; then
  echo "smoke: an e-mail address appears in the worker logs" >&2; exit 1
fi
reach() {
  compose exec -T app /nodejs/bin/node -e \
    "fetch(process.argv[1]).then(()=>process.exit(0)).catch(()=>process.exit(1))" "$1" >/dev/null 2>&1
}
reach https://gateway:8443/auth/v1/health || { echo "smoke: the app cannot reach the gateway" >&2; exit 1; }
if reach http://auth:9999/health; then
  echo "smoke: the app container can reach Auth directly (it must go through the gateway)" >&2; exit 1
fi

echo "smoke: error tracking — a browser error and a server error (Auth down) must reach GlitchTip, scrubbed"
# Browser report through the app's tunnel, with personal data in the message and the page URL.
envelope="$(printf '%s\n%s\n%s' '{"dsn":"https://browser@errors.invalid/1"}' '{"type":"event"}' \
  '{"exception":{"values":[{"type":"TypeError","value":"failed for leak.check@sovereign.example 0501234567"}]},"request":{"url":"http://localhost:3200/ar/suite?name=LeakCheck"}}')"
[[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST --data-binary "$envelope" \
  http://localhost:3200/api/monitoring/errors)" == "202" ]] ||
  { echo "smoke: the browser error tunnel did not accept the report" >&2; exit 1; }
# Server error: sign in while the Auth gateway is down (AuthServiceError → reportError → GlitchTip).
compose stop gateway >/dev/null
(cd "$ROOT/apps/suite" && E2E_BASE_URL=http://localhost:3200 AUTH_OUTAGE_E2E=1 \
  pnpm exec playwright test e2e/auth-outage.spec.ts --project=desktop-chromium) ||
  { compose start gateway >/dev/null; exit 1; }
compose start gateway >/dev/null
events=""
for i in $(seq 1 30); do
  events="$(compose exec -T glitchtip python manage.py shell <glitchtip/events.py 2>/dev/null || true)"
  if grep -q 'AuthServiceError' <<<"$events" && grep -q '"TypeError"' <<<"$events"; then break; fi
  [[ $i -eq 30 ]] && { echo "smoke: the browser and server errors did not both reach GlitchTip" >&2; exit 1; }
  sleep 2
done
planted=(leak.check@sovereign.example 0501234567 LeakCheck outage.check@sovereign.example
  Outage-Check-Password-1 "$EMAIL" "$PASSWORD" "$PARITY_EMAIL" "$PARITY_PASSWORD")
for leak in "${planted[@]}"; do
  if grep -qF "$leak" <<<"$events"; then
    echo "smoke: personal data reached the error tracker" >&2; exit 1
  fi
done
if grep -qE '[[:alnum:]._%+-]+@[[:alnum:]-]+(\.[[:alnum:]-]+)*\.[[:alpha:]]{2,}' <<<"$events"; then
  echo "smoke: an e-mail address reached the error tracker" >&2; exit 1
fi
grep -q '\[redacted\]' <<<"$events" || { echo "smoke: error messages were not redacted" >&2; exit 1; }
# GlitchTip's own scrubber marks what it removes with [Filtered]: that only happens when the app let
# something through, so it must never appear (it would otherwise hide an app scrubbing regression).
if grep -qF '[Filtered]' <<<"$events"; then
  echo "smoke: GlitchTip had to scrub data the app should have removed" >&2; exit 1
fi

# The error paths above wrote new log lines: scan the logs once more for the planted values, any e-mail
# address and the installation's secrets.
app_logs="$(compose logs --no-log-prefix app 2>&1)"
all_logs="$(compose logs --no-log-prefix 2>&1)"
for leak in "${planted[@]}"; do
  if grep -qF "$leak" <<<"$app_logs"; then
    echo "smoke: personal data appears in the app logs after the error checks" >&2; exit 1
  fi
done
if grep -qE '[[:alnum:]._%+-]+@[[:alnum:]-]+(\.[[:alnum:]-]+)*\.[[:alpha:]]{2,}' <<<"$app_logs"; then
  echo "smoke: an e-mail address appears in the app logs after the error checks" >&2; exit 1
fi
for name in AUTH_DB_PASSWORD APP_SERVER_DB_PASSWORD APP_WORKER_DB_PASSWORD APP_QUEUE_DB_PASSWORD \
  ERRORS_DB_PASSWORD GLITCHTIP_ADMIN_PASSWORD GLITCHTIP_SECRET_KEY; do
  value="$(secret "$name")"
  [[ ${#value} -ge 32 ]] || { echo "smoke: the secret $name is missing from .secrets/.env" >&2; exit 1; }
  if grep -qF "$value" <<<"$all_logs"; then
    echo "smoke: the secret $name appears in the container logs" >&2; exit 1
  fi
done
# The Auth admin key exists in the WORKER only (ADR 0002 §7; T-M2-07 review H1, T-M2-17): the app signs
# invitees up through the public API and queues reset requests; no other container — the app least of
# all — has a secret/service-role key or a service_role token.
grep -q '^SUPABASE_SECRET_KEY=' .secrets/.env && { echo "smoke: .secrets/.env still holds SUPABASE_SECRET_KEY" >&2; exit 1; }
[[ -n "$(compose ps -a -q app)" ]] || { echo "smoke: no app container to inspect" >&2; exit 1; }
for service in app db auth gateway worker mailpit glitchtip errors-db; do
  for id in $(compose ps -a -q "$service"); do
    env_vars="$($DOCKER inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$id")"
    service_role=0
    # Any JWT in the environment that carries role service_role.
    for jwt in $(grep -oE 'ey[A-Za-z0-9_-]+\.ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' <<<"$env_vars" || true); do
      if node -e 'const p = JSON.parse(Buffer.from(process.argv[1].split(".")[1], "base64url")); process.exit(p.role === "service_role" ? 0 : 1)' "$jwt" 2>/dev/null; then
        service_role=1
      fi
    done
    if [[ "$service" == "worker" ]]; then
      grep -qE '^SUPABASE_SECRET_KEY=ey' <<<"$env_vars" && [[ $service_role -eq 1 ]] ||
        { echo "smoke: the worker must hold the Auth admin key (service_role token) for reset links and bans" >&2; exit 1; }
      continue
    fi
    if grep -qE '^(SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY)=' <<<"$env_vars" || [[ $service_role -eq 1 ]]; then
      echo "smoke: $service has an Auth admin key in its environment" >&2; exit 1
    fi
  done
done
# Invitation tokens (credentials) never reach a log: they exist only in the e-mails.
for token in "${INVITE_TOKENS[@]}"; do
  if grep -qF "$token" <<<"$all_logs"; then
    echo "smoke: an invitation token appears in the container logs" >&2; exit 1
  fi
done

echo "smoke: the workers log structured lines and stop gracefully"
# Logs captured first: `grep -q` stops reading early, which fails the pipe under pipefail.
worker_logs="$(compose logs --no-log-prefix worker 2>&1)"
grep -q '"service":"jadarat-worker"' <<<"$worker_logs" ||
  { echo "smoke: the worker does not write the platform's structured log lines" >&2; exit 1; }
compose stop worker >/dev/null
for id in $(compose ps -a -q worker); do
  [[ "$($DOCKER inspect -f '{{.State.ExitCode}}' "$id")" == "0" ]] ||
    { echo "smoke: a worker did not stop cleanly on SIGTERM" >&2; exit 1; }
done
