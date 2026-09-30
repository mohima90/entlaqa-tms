# OWASP ASVS Level 2 Mapping — Jadarat Platform & TMS

| | |
|---|---|
| **Backlog** | T-M1-C04 |
| **Standard** | **OWASP Application Security Verification Standard 5.0.0** (released May 2025), Level 2 — required by NFR-SEC-05 and Development Plan §6.3 Track C |
| **Version** | 0.1 — 30 Sep 2026 |
| **Owner** | Security Lead (Claude agent) |
| **Related** | [TM-0001](threat-models/TM-0001-platform.md) · [Secure coding standard](secure-coding-standard.md) · ADR 0001–0003 |

## How to read this mapping

- Organized by the 17 ASVS 5.0 chapters and their sections. The "Key L2 requirements" column paraphrases the Level 1+2 intent **as applied to Jadarat**; it is not a copy of the standard. When requirement-level items are imported into the tracker, requirement numbers must be taken from the published ASVS 5.0.0 text (numbering changed completely from 4.0.3, so do not reuse 4.x IDs).
- **Implemented in** names the package/ADR that owns the control (package names per ADR 0001; `@jadarat/` scope). ADR 0001–0012 are all *Proposed* at the time of writing.
- **Verification** codes: **U** unit test (Vitest) · **RLS** pgTAP database test · **I** integration test (server actions/routes against local Supabase) · **E2E** Playwright (AR + EN) · **SAST** CodeQL/Semgrep (gate 10) · **SCA** dependency scan (gate 11) · **SEC** secret scan (gate 12) · **CFG** configuration-as-code assertion in CI · **DAST** nightly ZAP · **M** manual security review · **PT** independent pen test (before GA).
- **R1**: ✅ required for R1 GA · ◐ partially in R1 (rest later) · R2/R3 = when the feature ships · N/A with reason.
- Every R1 story's DoD (Plan §4.2) must reference the sections it touches; the security review record (`docs/security/reviews/`) lists which rows were verified.

---

## V1 Encoding and Sanitization

| Section | Key L2 requirements (Jadarat) | Implemented in | Verification | R1 |
|---|---|---|---|---|
| V1.1 Architecture | Decode/unescape input once, then encode at the output sink; one output encoder per context (HTML via React, SQL via Drizzle parameters, URLs via `URL`, CSV via export encoder) | `packages/ui`, `platform-core` (encoders), SCS-6 | M, SAST | ✅ |
| V1.2 Injection prevention | All SQL through Drizzle parameterized queries inside `withUserTx`; `sql.raw` only in reviewed helpers with allow-listed identifiers; PL/pgSQL dynamic SQL via `format('%I')` + `USING`; no OS command execution from request data; LDAP/XPath N/A; CSV/XLSX formula injection neutralized on export (FR-RPT-02, FR-IAM-04 error reports); e-mail header injection prevented in notification sender (CR/LF rejected) | `platform-db`, `platform-notifications`, `modules/tms` reports, SCS-5, SCS-6.6 | U (payload corpus incl. Arabic), SAST (custom Semgrep rules), DAST | ✅ |
| V1.3 Sanitization | Rich text (course descriptions, templates) sanitized with an allow-list (DOMPurify) server-side before storage **and** at render via `SafeRichText`; SVG never rendered inline; template variables escaped (logic-less templates for e-mail/certificates); SSRF-safe URL handling delegated to V13/V15 controls; untrusted content passed to LLMs is delimited and not executed (R2) | `packages/ui` (`SafeRichText`), `platform-notifications`, certificate designer in `modules/tms`, SCS-6, SCS-19 | U (XSS corpus incl. bidi controls), DAST, M | ✅ |
| V1.4 Memory/unmanaged code | TypeScript/Node only; no native addons beyond reviewed ones (e.g., image processing) | `packages/config` dependency policy | SCA, M | ✅ (low relevance) |
| V1.5 Safe deserialization | No `eval`/`Function`/`vm` on data; JSON parsed then Zod-validated; XLSX/XML parsers with entity expansion disabled; no YAML with custom tags; server-action arguments treated as untrusted and validated | `platform-core` (Zod helpers), importer in `platform-identity`, SCS-4 | U (malicious fixtures), SAST | ✅ |

## V2 Validation and Business Logic

| Section | Key L2 requirements (Jadarat) | Implemented in | Verification | R1 |
|---|---|---|---|---|
| V2.1 Documentation | Validation rules documented as Zod schemas in `packages/contracts`/module code; business limits (capacity, waitlists, edit windows BR-ATT-1, invitation resend max 3, import 10,000 rows) documented in stories | `contracts`, `modules/tms`, story templates | M | ✅ |
| V2.2 Input validation | Every server action/route validates input with a strict Zod schema before the handler (`defineAction`); positive validation for IDs (UUID), enums, dates (UTC ISO), phone (E.164), national ID/Iqama formats (NFR-L10N-10) after Arabic-Indic digit normalization; server-side only (client validation is UX) | `platform-rbac` (`defineAction`), `platform-core` validators, SCS-4 | U, I (unknown keys → 400) | ✅ |
| V2.3 Business logic security | Steps in order (e.g., enroll → approve → attend → certify); single-use approval links; one check-in per learner per day (unique constraint); SoD rules (FR-IAM-09, R2); limits on high-value operations (bulk enroll, exports) with preview/confirm; race conditions handled with transactions/constraints (capacity, numbering gaps FR-CRT-02) | `platform-rbac`, `modules/tms` domain services, `platform-db` constraints | I (race tests with parallel requests), E2E J5/J8/J9 | ✅ |
| V2.4 Anti-automation | Rate limits on sign-in, OTP, invitations, sign-up, certificate verification, QR check-in, exports; per-tenant quotas; bot challenge on public forms (PostgreSQL limiter ADR-0011 §4; bot challenge open — TM F-05) | `platform-core` (`rateLimit`), ADR-0011 §4, SCS-16 | I, DAST | ✅ |

## V3 Web Frontend Security

| Section | Key L2 requirements (Jadarat) | Implemented in | Verification | R1 |
|---|---|---|---|---|
| V3.1 Documentation | Browser security features expected (CSP3 nonces, `strict-dynamic`) and supported browsers (NFR-COMP-01) documented | This mapping + SCS-7 | M | ✅ |
| V3.2 Unintended content interpretation | Correct `Content-Type` + `charset=utf-8`; `X-Content-Type-Options: nosniff`; user files served from the storage origin with `Content-Disposition: attachment` except re-encoded images; no inline SVG/HTML from users | `apps/suite` proxy headers, `platform-files`, SCS-10 | E2E header assertions, DAST | ✅ |
| V3.3 Cookie setup | Session cookies `Secure`, `HttpOnly`, `SameSite=Lax`, host-only, `__Host-` prefix where the library allows (verify with `@supabase/ssr` chunked cookies); no sensitive data in non-session cookies; locale cookie non-sensitive | `platform-identity` (SSR client factory), ADR-0003 §2, SCS-8 | E2E cookie assertions, DAST | ✅ |
| V3.4 Security headers | CSP with per-request nonce, `strict-dynamic`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'` (tenant embedding only via explicit allow-list later); HSTS with `includeSubDomains` (+ preload for the platform apex after validation); `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy` allowing camera (QR) and geolocation (geo-fence) only for `self`; `Cross-Origin-Opener-Policy: same-origin` | `apps/suite/proxy.ts`, SCS-7 | E2E header tests on representative routes, DAST, CSP violation reporting | ✅ |
| V3.5 Browser origin separation | CSRF: Server Actions use Next.js Origin/Host check; cookie-authenticated mutating route handlers verify `Origin` against the tenant host; no state change on GET (approval links, tenant switch); CORS closed by default, public API (R2) uses bearer tokens; user content on a separate origin (storage) | `platform-rbac` (`defineRoute`), SCS-8 | I (cross-origin POST rejected), DAST | ✅ |
| V3.6 External resource integrity | No third-party scripts from CDNs in the app; fonts self-hosted (Arabic fonts NFR-L10N-02); any unavoidable external script uses SRI and CSP allow-list | `apps/suite`, `packages/ui` | M, CSP report review | ✅ |
| V3.7 Other browser considerations | Open-redirect prevention (relative paths only, TM T-65); no sensitive data in URLs (tokens in URL only where single-use and short-lived: QR, approval, signed URLs); service worker does not cache authenticated responses (R1); warn before navigating to external links in user content | `platform-identity`, `platform-core`, PWA config in `apps/suite` | U (redirect validator), E2E | ✅ |

## V4 API and Web Service

| Section | Key L2 requirements (Jadarat) | Implemented in | Verification | R1 |
|---|---|---|---|---|
| V4.1 Generic web service | Correct content types; JSON only; RFC 9457 problem details (ADR-0011); consistent 401/403/404 semantics (out-of-scope → 404); `Cache-Control: no-store` on authenticated responses; request size limits (server action body size limit configured) | `platform-core` (errors), `apps/suite` config, ADR-0011 | I, DAST | ✅ |
| V4.2 HTTP message structure | Edge/proxy normalizes and rejects ambiguous requests (conflicting `Content-Length`/`Transfer-Encoding`, oversized headers); trusted-proxy list for `X-Forwarded-*` (host→tenant depends on it, TM T-04) | Edge config (Vercel / sovereign ingress), ADR-0010 | CFG, PT | ✅ |
| V4.3 GraphQL | Supabase GraphQL (`pg_graphql`) disabled or not exposing any tenant schema; no custom GraphQL API planned | `supabase/config.toml`, self-hosted env | CFG, DAST probe `/graphql/v1` | ✅ (verify disabled) |
| V4.4 WebSocket | Supabase Realtime over WSS only; JWT on connect and on refresh (`setAuth`); private channels; topic authorization via Realtime Authorization policies (tenant + permission); message size/rate limits from Realtime config | ADR-0002 §8, `platform-notifications` (in-app realtime), SCS-5.7 | RLS (policies on `realtime.messages`), E2E (foreign topic denied) | ✅ |

## V5 File Handling

| Section | Key L2 requirements (Jadarat) | Implemented in | Verification | R1 |
|---|---|---|---|---|
| V5.1 Documentation | Allowed types and max size per purpose (materials ≤ 200 MB FR-CAT-06; evidence; branding images; imports CSV/XLSX; signatures) documented in `platform-files` registry | `platform-files`, ADR-0006 | M | ✅ |
| V5.2 Upload and content | Size enforced when issuing signed upload URLs and at bucket level; type by magic bytes against allow-list; archive handling with decompressed-size limits; images re-encoded (strips EXIF GPS — privacy); quarantine until malware scan passes | `platform-files`, scanner worker (`platform-jobs`) | I (EICAR, polyglot, oversized, zip bomb), U | ✅ |
| V5.3 Storage | Private buckets; object keys generated server-side `<tenant_id>/<module>/<entity>/<id>/<uuid>` (no user-controlled paths); storage RLS on tenant prefix; original filename stored as metadata only, sanitized (bidi controls removed) | `platform-files`, `supabase/migrations` (storage policies), ADR-0002 §8 | RLS (storage policies), I | ✅ |
| V5.4 Download | Signed URLs issued per request after `defineAction` authorization, TTL ≤ 5 min default; `Content-Disposition: attachment; filename*=` with safe name; C4 file downloads audited | `platform-files`, `platform-audit` | I, E2E | ✅ |

## V6 Authentication

| Section | Key L2 requirements (Jadarat) | Implemented in | Verification | R1 |
|---|---|---|---|---|
| V6.1 Documentation | Auth controls, rate limits and lockout documented per deployment model (cloud and self-hosted differences — TM F-09) | ADR-0003, ADR-0010 | M | ✅ |
| V6.2 Password security | Min length ≥ 8 (15 recommended when MFA is off; tenant policy may raise), max ≥ 64, no composition rules forced beyond tenant policy, paste allowed, breached-password check (NFR-SEC-01; self-hosted fallback needed because the check calls an external service), password change requires current password/reauthentication | Supabase Auth config, `platform-identity` | CFG, I | ✅ |
| V6.3 General authentication | Anti-automation and lockout on sign-in (FR-IAM-13) via Auth rate limits + application limits/hooks; no default accounts; uniform errors; notification on suspicious sign-in / new factor; MFA available to all and **required** for privileged roles (AAL2) | Supabase Auth, `platform-identity`, `platform-rbac` (AAL2 metadata) | I, E2E J2, PT | ✅ |
| V6.4 Factor lifecycle and recovery | Invitation tokens expire (7 days), max 3 resends, revocable (FR-IAM-03); recovery does not bypass MFA (AAL2 still required for privileged actions after reset); factor enrollment/removal requires AAL2 when a verified factor exists; notifications on changes | `platform-identity`, Supabase Auth | I | ✅ |
| V6.5 General MFA | TOTP (R1); e-mail/SMS OTP only after spike confirms support (ADR-0003); OTP single use, time-limited, attempt-limited; AAL recorded in `aal` claim and enforced server-side | Supabase Auth MFA, `platform-rbac` | I, E2E J2 | ✅ |
| V6.6 Out-of-band | SMS/e-mail OTP (if adopted) short expiry, rate-limited, bound to the transaction (check-in OTP bound to session-day); SMS considered a restricted authenticator (not for privileged roles) | `platform-identity`, `platform-notifications` | I | ◐ (R1 spike, R2) |
| V6.7 Cryptographic authentication | WebAuthn/passkeys — recommended for platform staff via ENTLAQA IdP (verify Supabase support before promising to tenants) | Platform console SSO | M | R2 |
| V6.8 Authentication with an IdP | SAML/OIDC per tenant: assertion signature, audience, expiry, replay validated by Supabase; SSO provider bound to tenant and DNS-verified domains; no e-mail-based auto-linking across IdPs; break-glass admin keeps password + MFA (BR-IAM-2) | Supabase SSO, `platform-identity` | I (rogue IdP test), PT | R2 |

## V7 Session Management

| Section | Key L2 requirements (Jadarat) | Implemented in | Verification | R1 |
|---|---|---|---|---|
| V7.1 Documentation | Session model documented: Supabase access token (target 15 min) + rotating refresh token in HttpOnly cookies; tenant inactivity/absolute timeouts (FR-IAM-13); concurrent session limit | ADR-0003 §2 | M | ✅ |
| V7.2 Fundamental security | Every request verified server-side (`getClaims()` with asymmetric keys; `getUser()` before sensitive operations); session tokens random/signed by Auth; new session on sign-in and privilege change (tenant switch issues a new token) | `platform-identity` (`getRequestContext`), ADR-0003 | U (tampered tokens), I | ✅ |
| V7.3 Timeouts | Inactivity and absolute timeouts per tenant policy enforced by the application where Auth does not provide them; re-authentication for sensitive operations | `platform-identity` | I | ✅ |
| V7.4 Termination | Logout revokes the refresh session (global/others options), clears cookies and PWA caches; admin force-logout and session list (FR-IAM-13); deactivation terminates all sessions (FR-IAM-05) | `platform-identity`, Supabase Auth admin API (worker/admin path) | I, E2E | ✅ |
| V7.5 Session abuse defenses | Refresh-token reuse detection; re-authentication before changing e-mail/password/MFA; users can view active sessions; host-only cookies prevent cross-tenant cookie tossing | Supabase Auth config, `platform-identity` | CFG, I | ✅ |
| V7.6 Federated re-authentication | SSO sessions: IdP `ForceAuthn`/max-age for sensitive operations where supported; local session lifetime not longer than tenant policy | Supabase SSO config | I | R2 |

## V8 Authorization

| Section | Key L2 requirements (Jadarat) | Implemented in | Verification | R1 |
|---|---|---|---|---|
| V8.1 Documentation | Permission registry (code, AR/EN label, risk, AAL2 flag) per module; role matrix (BRD App. B); data scopes (own, direct/tree reports, org units, branches, legal entity, tenant, assigned) documented | `platform-rbac`, `modules/tms/permissions`, ADR-0003 | M, CI check (unknown permission codes fail) | ✅ |
| V8.2 General design | Function-level: `defineAction`/`defineRoute` on every action and mutating route (lint gate); data-level: resource scope check + `scopeFilter`; field-level: restricted fields (FR-IAM-02, FR-ADM-11) projected per permission in DTOs, exports and reports; deny by default; tenant isolation by RLS (RESTRICTIVE policy, FORCE RLS, composite FKs) | `platform-rbac`, `platform-db`, `supabase/migrations`, ADR-0002/0003 | U (`authorize`, `scopeFilter`), I (403/404 negatives per action), RLS (isolation per table + no-claim test), E2E J13 | ✅ |
| V8.3 Operation-level | Authorization evaluated server-side on every request with current grants (not JWT-embedded); changes effective immediately; DB context applied per transaction (`set local role authenticated` + verified claims via `withUserTx`) so RLS is evaluated as the user; `app_server` has no `BYPASSRLS` and (recommended) `NOINHERIT` | `platform-rbac`, `platform-db` | I (revoke → next request denied; interleaved-tenant pool test), RLS | ✅ |
| V8.4 Other considerations | Multi-tenant: tenant from verified claim, host = claim; admin interfaces (platform console) separately authenticated with AAL2 and no standing tenant access; impersonation grants time-limited and audited; SoD (R2); delegation (R2) | `platform-identity`, `platform-rbac`, console routes in `apps/suite` | I, E2E, PT | ✅ (SoD/delegation R2) |

## V9 Self-contained Tokens

| Section | Key L2 requirements (Jadarat) | Implemented in | Verification | R1 |
|---|---|---|---|---|
| V9.1 Source and integrity | Supabase JWTs verified with asymmetric signing keys from the project JWKS; algorithm fixed by key type (no `none`/HS confusion); key rotation supported; only verified claims reach `set_config` (branded `VerifiedClaims`). Platform-issued tokens (QR check-in, approval links, impersonation grants, verification codes) use HMAC-SHA256 or signatures with `kid`-based rotation keys from KMS | `platform-identity`, `platform-core` (token utilities), ADR-0010 §5 + key inventory (TM F-07) | U (tampered/alg/expired/wrong-`kid`), SAST rule on `set_config` | ✅ |
| V9.2 Content | Validate `exp`, `nbf`/`iat`, `aud` (`authenticated`), issuer; purpose/type field in platform tokens to prevent cross-use (a QR token cannot be used as an approval token); tenant and subject bound inside the token; single-use tokens tracked server-side | `platform-identity`, `platform-core` | U | ✅ |

## V10 OAuth and OIDC

| Section | Key L2 requirements (Jadarat) | Implemented in | Verification | R1 |
|---|---|---|---|---|
| V10.1 Generic | PKCE, exact redirect URIs, `state`/nonce, no tokens in URLs/logs | Supabase Auth (OIDC providers), connectors | CFG, I | R2 |
| V10.2 OAuth client | Connectors (Jadarat LMS OAuth client credentials, FR-LMS-02) store secrets in vault; tokens cached server-side per connection with least-privilege scopes; token endpoint TLS-validated | `modules/tms` integration (recommended `platform-integration`, TM F-12) | I, M | ◐ (Jadarat LMS L2 in R1) |
| V10.3 Resource server | Public API `/api/v1` (R2): validate audience, scope → permission mapping, tenant bound to client; rate limits per client (FR-INT-02) | ADR-0011 | I, contract tests | R2 |
| V10.4 Authorization server | If TMS acts as OIDC provider for LMS SSO (FR-LMS-03) or MCP OAuth (FR-AI-11): consent, client registration controls, refresh rotation, short codes — decision pending | ADR-0011 / connector ADR | PT | R1 decision (FR-LMS-03 may use tenant IdP instead) |
| V10.5 OIDC client | ID token validation (iss, aud, exp, nonce) by Supabase for OIDC sign-in | Supabase Auth | CFG | R2 |
| V10.6 OpenID Provider | See V10.4 | — | — | R1 decision / R3 |
| V10.7 Consent management | Users/admins see and revoke connected apps and scopes | ADR-0011 | E2E | R2–R3 |

## V11 Cryptography

| Section | Key L2 requirements (Jadarat) | Implemented in | Verification | R1 |
|---|---|---|---|---|
| V11.1 Inventory and documentation | Crypto inventory: TLS, JWT keys, HMAC keys (QR, approvals, webhooks, verification codes), field-encryption keys (national IDs, bank details NFR-SEC-03), backup encryption; owners and rotation periods; post-quantum readiness noted for later | ADR-0010 §5 + key inventory (TM F-07) | M | ✅ |
| V11.2 Implementation | Only Node `crypto` / WebCrypto and vetted libraries; no custom crypto; constant-time comparisons (`timingSafeEqual`); failure closes | `platform-core/crypto`, SCS-13 | U, SAST | ✅ |
| V11.3 Encryption algorithms | AES-256-GCM with random 96-bit nonces for field-level encryption (envelope encryption, data keys wrapped by KMS); no ECB/CBC without MAC; authenticated encryption only | `platform-core/crypto`, `platform-db` column helpers | U | ✅ |
| V11.4 Hashing | SHA-256/HMAC-SHA256 for integrity and blind indexes (keyed); passwords handled by Supabase Auth (bcrypt); API keys stored as SHA-256 of 256-bit random secrets (R2) | `platform-core/crypto`, Supabase Auth | U, M | ✅ |
| V11.5 Random values | `crypto.randomBytes`/`randomUUID`/`getRandomValues` only; `Math.random` banned for security use; verification codes ≥ 128 bits of entropy (or HMAC-derived short codes) | `platform-core`, ESLint rule | SAST, U | ✅ |
| V11.6 Public-key crypto | JWT signing keys (ES256/RS256) managed by Supabase; PAdES/Open Badges signing (R3) with tenant keys in KMS/HSM | Supabase Auth, R3 credentials | M | R3 (signing) |
| V11.7 In-use data crypto | Decrypted C4 values only in server memory for the request; not placed in React props unless authorized and needed; no caching of decrypted values | `platform-db`, DTO layer | M, U | ✅ |

## V12 Secure Communication

| Section | Key L2 requirements (Jadarat) | Implemented in | Verification | R1 |
|---|---|---|---|---|
| V12.1 General TLS | TLS 1.2+ only, TLS 1.3 preferred, strong suites, HSTS (NFR-SEC-03); certificate automation for tenant subdomains/custom domains (R2) | Edge (Vercel / sovereign ingress), ADR-0010 | CFG, external TLS scan | ✅ |
| V12.2 External-facing HTTPS | All public hosts HTTPS; HTTP → HTTPS redirect; no mixed content (CSP `upgrade-insecure-requests`) | Edge, `apps/suite` | DAST | ✅ |
| V12.3 Service-to-service | TLS with certificate validation to Supabase (pooler `sslmode=verify-full` where supported — verify), providers, LMS; no `NODE_TLS_REJECT_UNAUTHORIZED=0`; mTLS or private network between app, workers and DB in sovereign | `platform-db`, `platform-core` (`safeFetch`), ADR-0010 | CFG, SAST rule | ✅ |

## V13 Configuration

| Section | Key L2 requirements (Jadarat) | Implemented in | Verification | R1 |
|---|---|---|---|---|
| V13.1 Documentation | Inventory of external services and their credentials per environment and deployment model; exposed Supabase schemas documented (none for tenant data) | ADR-0010, `infra/`, ADR-0002 §5 | M | ✅ |
| V13.2 Backend communication | Least-privilege DB roles: `app_server` (member of `authenticated`, no `BYPASSRLS`, owns no tables, recommended `NOINHERIT`), worker role (recommended separate — TM F-01/F-03), migration owner; admin client only in `platform-db/admin`; outbound calls only through `safeFetch` | `platform-db`, `supabase/migrations` (roles/grants), ADR-0001/0002 | RLS/CFG (role attributes asserted), dependency-cruiser gate | ✅ |
| V13.3 Secret management | Secrets in vault/KMS (NFR-SEC-04), injected at runtime; never in repo, images or `NEXT_PUBLIC_*`; rotation; per-environment separation; connector secrets never displayed after creation | `platform-core/env` (schema validation), CI | SEC (gitleaks), CFG (env schema), bundle scan | ✅ |
| V13.4 Unintended information leakage | No stack traces, debug endpoints or source maps publicly served in production (upload source maps to error tracker only); `X-Powered-By` disabled; directory listings off; `.git`/env files not deployed; server banner minimized | `apps/suite` `next.config`, edge | DAST, CFG | ✅ |

## V14 Data Protection

| Section | Key L2 requirements (Jadarat) | Implemented in | Verification | R1 |
|---|---|---|---|---|
| V14.1 Documentation | Data classification (C1–C4, TM-0001 §2) with handling rules; data inventory per table (classification column in migration comments); retention per data type (FR-AUD-03, DR-5) | `platform-core` (classification registry), migrations | M, CI check (every column of C4 tables classified) | ✅ |
| V14.2 General data protection | Sensitive data never in URLs/query strings; minimization (geo only at check-in when enabled, §12.2); field-level encryption for national IDs/bank details; consent capture (FR-AUD-05); export/erasure workflows (FR-AUD-02/04, R2); no PII in logs; data location per tenant (BRD §15) | `platform-db`, `platform-audit`, `platform-identity` (consent), SCS-13/15 | U, I, M (privacy review per release) | ◐ (export/erasure R2) |
| V14.3 Client-side data protection | `Cache-Control: no-store` on authenticated responses; no C3/C4 in `localStorage`; PWA offline store (R2) encrypted and cleared on logout; autocomplete off for sensitive fields (national ID) | `apps/suite`, `packages/ui` | E2E | ✅ |

## V15 Secure Coding and Architecture

| Section | Key L2 requirements (Jadarat) | Implemented in | Verification | R1 |
|---|---|---|---|---|
| V15.1 Documentation | Threat models (platform + per epic), ADRs with security impact, component risk classification (dangerous components: PDF renderer, importer, rich text, connectors, AI gateway) | `docs/security/`, `docs/adr/` | M | ✅ |
| V15.2 Architecture and dependencies | Modular monolith boundaries enforced (dependency-cruiser); dependency policy (licence, age, maintenance, SBOM); risky components isolated (PDF renderer sandbox TM F-06, scanner, workers separate from web runtime TM F-03); patch SLAs | ADR-0001, `packages/config`, CI | SCA, CI gates 1/11/13, M | ✅ |
| V15.3 Defensive coding | TypeScript strict; Zod at boundaries; no prototype-pollution-prone deep merges on user input; explicit field mapping (no mass assignment); `server-only` for server modules; DTOs (no raw rows to client components) | All packages, SCS-1/3/4 | SAST, U | ✅ |
| V15.4 Safe concurrency | DB constraints + transactions for capacity, numbering, single-use tokens, one-check-in rule; idempotent consumers (ADR-0004); no shared mutable per-request state in module scope (serverless/container reuse) | `platform-db`, `platform-events`, `modules/tms` | I (parallel request tests) | ✅ |

## V16 Security Logging and Error Handling

| Section | Key L2 requirements (Jadarat) | Implemented in | Verification | R1 |
|---|---|---|---|---|
| V16.1 Documentation | Log inventory: application logs, audit log (FR-AUD-01), security events, DB/admin logs; retention and location per deployment | ADR-0009, `platform-audit` | M | ✅ |
| V16.2 General logging | Structured JSON logs with UTC timestamps, tenant correlation id, request id, pseudonymous user id; no PII/secrets (redaction) (NFR-OBS-01) | `platform-core/log`, ADR-0009 | U (redaction), M (sampling) | ✅ |
| V16.3 Security events | Log and alert: auth success/failure, lockouts, MFA changes, AAL2 step-ups, authorization denials (403/404 from `defineAction`), host/claim mismatch, webhook signature failures, SSRF blocks, rate-limit hits, impersonation start/stop, admin-client use, RLS violations (SQLSTATE 42501) | `platform-audit`, `platform-core/log`, `platform-rbac` | I (events emitted), alert tests | ✅ |
| V16.4 Log protection | Audit log append-only (no UPDATE/DELETE grants, trigger), hash chain + external anchor; log shipping to a store tenants cannot modify; log injection prevented (structured fields, CR/LF escaped) | `platform-audit`, `supabase/migrations` | RLS (immutability tests), U | ✅ |
| V16.5 Error handling | Generic errors to users (RFC 9457, localized AR/EN), details only in logs; Next.js production error digests; fail closed on authorization/crypto/config errors; global error boundaries per module | `platform-core/errors`, `apps/suite` error boundaries | I, DAST | ✅ |

## V17 WebRTC

| Section | Key L2 requirements (Jadarat) | Implemented in | Verification | R1 |
|---|---|---|---|---|
| V17.1–17.3 | Not applicable: Jadarat does not run TURN/media/signaling servers; VILT uses Zoom/Teams/Webex (FR-SCH-10, FR-ATT-07). Re-assess if in-product video or transcription capture (FR-AI-09) is built | — | — | N/A |

---

## Summary of R1 gaps that need decisions

| Gap | ASVS area | Needed from |
|---|---|---|
| Self-hostable bot challenge; limiter/lockout in front of Supabase Auth sign-in and OTP (TM F-05; limiter itself in ADR-0011 §4) | V2.4, V6.3 | ADR-0003 / ADR-0011 |
| Key inventory: `kid`/overlap for HMAC keys, blind-index keys, Server Actions encryption key (TM F-07; envelope encryption in ADR-0010 §5) | V9.1, V11.1, V13.3 | ADR-0010 |
| Production tick mode puts worker credentials in the web runtime (TM F-03) and DB-level claim validation (TM F-01) | V8.3, V13.2 | ADR-0002 / ADR-0005 |
| PDF renderer isolation (TM F-06) | V1.3, V15.2 | ADR-0006 §6 (M5 spike) |
| Self-hosted parity for breached-password check, asymmetric keys, hooks (TM F-09) | V6.2, V9.1 | T-M1-D04 spike |
| OIDC-provider role for LMS SSO (FR-LMS-03) | V10.4/V10.6 | Connector ADR before M6 |
