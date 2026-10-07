#!/usr/bin/env bash
# Self-hosted (sovereign) smoke test, T-M1-D04/D06: brings up the whole stack from this directory, deploys
# the migrations with the production deploy script, creates a user and an organization, signs in through a
# real browser against the app container, checks the audit trail and TLS, runs two background-job workers
# and checks they dispatch an event, sends a test e-mail over SMTP with STARTTLS to the stand-in relay
# (Mailpit), runs the invitation journey (invite in the UI, e-mail, accept link from Mailpit, set a
# password, signed in; expired/revoked/used links; Auth's sign-up hook refuses sign-ups without a valid
# invitation for that e-mail), sends a browser and a server error to the in-country
# error tracker (GlitchTip) and checks they arrive without personal data, then tears everything down.
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
USER_ID="$(NEW_USER_PASSWORD="$PASSWORD" node create-user.mjs "$EMAIL")"
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
NEW_USER_PASSWORD="$PARITY_PASSWORD" node create-user.mjs "$PARITY_EMAIL" >/dev/null
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
MANAGER_ID="$(NEW_USER_PASSWORD="$MANAGER_PASSWORD" node create-user.mjs "$MANAGER_EMAIL")"
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
GUARD_ID="$(NEW_USER_PASSWORD="$GUARD_PASSWORD" node create-user.mjs "$GUARD_EMAIL")"
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
# Here Auth has no SMTP relay, so it would fail anyway; the database guard itself must refuse the
# change for every role (the migration role too) — that is what protects hosted Auth.
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
if [[ "$(q "select count(*) from platform.audit_events where data::text like '%منيرة%' or data::text like '%966551112233%'")" != "0" ]]; then
  echo "smoke: personal data reached the audit log" >&2; exit 1
fi

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
  "$GUARD_PASSWORD" "$GUARD_NEW_PASSWORD"; do
  if grep -qF "$value" <<<"$all_logs"; then
    echo "smoke: a test user's password appears in the container logs" >&2; exit 1
  fi
done
for value in "$EMAIL" "$PARITY_EMAIL" "$MANAGER_EMAIL"; do
  if grep -qF "$value" <<<"$app_logs"; then
    echo "smoke: a test user's e-mail address appears in the app logs" >&2; exit 1
  fi
done
if grep -qE '[[:alnum:]._%+-]+@[[:alnum:]-]+(\.[[:alnum:]-]+)*\.[[:alpha:]]{2,}' <<<"$app_logs"; then
  echo "smoke: an e-mail address appears in the app logs" >&2; exit 1
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
# No Auth admin key anywhere (T-M2-07, review H1): the app signs invitees up through the public API, so
# no container — the app least of all — has a secret/service-role key or a service_role token.
grep -q '^SUPABASE_SECRET_KEY=' .secrets/.env && { echo "smoke: .secrets/.env still holds SUPABASE_SECRET_KEY" >&2; exit 1; }
[[ -n "$(compose ps -a -q app)" ]] || { echo "smoke: no app container to inspect" >&2; exit 1; }
for service in app db auth gateway worker mailpit glitchtip errors-db; do
  for id in $(compose ps -a -q "$service"); do
    env_vars="$($DOCKER inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$id")"
    if grep -qE '^(SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY)=' <<<"$env_vars"; then
      echo "smoke: $service has an Auth admin key in its environment" >&2; exit 1
    fi
    # Any JWT in the environment must not carry role service_role.
    for jwt in $(grep -oE 'ey[A-Za-z0-9_-]+\.ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' <<<"$env_vars" || true); do
      if node -e 'const p = JSON.parse(Buffer.from(process.argv[1].split(".")[1], "base64url")); process.exit(p.role === "service_role" ? 0 : 1)' "$jwt" 2>/dev/null; then
        echo "smoke: $service has a service_role token in its environment" >&2; exit 1
      fi
    done
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
