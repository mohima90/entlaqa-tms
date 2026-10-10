#!/usr/bin/env bash
# Smoke-test helper for the browser journeys of infra/docker/smoke.sh (security.spec, T-M2-10). It does
# what a person does outside the browser, on the running self-hosted stack only:
#   e2e-helper.sh mfa-link <address> <confirm|remove> <ar|en> <n>
#       waits (up to 90 s) until <address> has received at least <n> "Confirm your authenticator app"
#       e-mails in the stand-in relay (Mailpit) and prints the <confirm|remove> link of the NEWEST one in
#       <ar|en> — the same link in the text and HTML parts, whole and unchanged (the token travels in the
#       fragment). The link is a credential: callers never log it.
#   e2e-helper.sh age-code <address>
#       makes the authenticator code of every session of <address> 20 minutes old in Auth
#       (auth.mfa_amr_claims), as if it had been entered then — Auth puts that time into the next access
#       token (amr), and high-risk actions want a code from the last 15 minutes (review L3). Prints how many
#       sessions were changed.
# Reads only the values it needs from .secrets/.env (as smoke.sh); prints nothing else.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
DOCKER="${DOCKER:-docker}"
compose() { $DOCKER compose --env-file .secrets/.env "$@"; }
secret() { sed -n "s/^$1=//p" .secrets/.env; }

case "${1:-}" in
  mfa-link)
    address="$2" kind="$3" locale="$4" want="$5"
    [[ "$kind" == confirm || "$kind" == remove ]] || { echo "e2e-helper: kind is confirm or remove" >&2; exit 2; }
    [[ "$locale" == ar || "$locale" == en ]] || { echo "e2e-helper: locale is ar or en" >&2; exit 2; }
    [[ "$want" =~ ^[1-9][0-9]?$ ]] || { echo "e2e-helper: n is a small positive number" >&2; exit 2; }
    for _ in $(seq 1 90); do
      # The IDs of the set-up e-mails to <address>, newest first (Mailpit lists newest first).
      mapfile -t ids < <(compose exec -T mailpit wget -qO- 'http://127.0.0.1:8025/api/v1/messages?limit=500' 2>/dev/null |
        node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
          try { for (const m of JSON.parse(s).messages ?? [])
            if ((m.To ?? []).some((t) => t.Address === process.argv[1]) && /Confirm your authenticator app/.test(m.Subject ?? ""))
              console.log(m.ID); } catch {} })' "$address")
      if [[ ${#ids[@]} -ge $want ]]; then
        compose exec -T mailpit wget -qO- "http://127.0.0.1:8025/api/v1/message/${ids[0]}" 2>/dev/null |
          node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
            let m = {}; try { m = JSON.parse(s); } catch {}
            const [kind, locale] = process.argv.slice(1);
            const html = (m.HTML ?? "").replace(/&amp;/g, "&"), text = m.Text ?? "";
            const re = new RegExp(`http://localhost:3200/${locale}/mfa/${kind}#token=[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])`);
            const a = html.match(re), b = text.match(re);
            if (!a || !b || a[0] !== b[0]) process.exit(1);
            process.stdout.write(a[0]); })' "$kind" "$locale"
        exit $?
      fi
      sleep 1
    done
    echo "e2e-helper: fewer than $want set-up e-mails reached the relay" >&2
    exit 1
    ;;
  age-code)
    address="$2"
    PGPASSWORD="$(secret POSTGRES_PASSWORD)" PGSSLMODE=verify-full PGSSLROOTCERT=.secrets/ca.crt \
      psql -h localhost -p 55432 -U postgres -d postgres -X -At -q -v ON_ERROR_STOP=1 -v address="$address" <<'SQL'
with aged as (
  update auth.mfa_amr_claims c set updated_at = now() - interval '20 minutes'
  from auth.sessions s join auth.users u on u.id = s.user_id
  where c.session_id = s.id and c.authentication_method = 'totp' and u.email = :'address'
  returning c.session_id)
select count(*) from aged;
SQL
    ;;
  *)
    echo "usage: e2e-helper.sh mfa-link <address> <confirm|remove> <ar|en> <n> | age-code <address>" >&2
    exit 2
    ;;
esac
