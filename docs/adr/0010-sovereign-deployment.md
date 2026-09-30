# ADR 0010 — Sovereign (in-country) deployment approach

**Status:** Proposed · **Date:** 30 Sep 2026 · **Backlog:** T-M1-B10 · **Related:** BRD §15 (FR-DEP-01…05), §11.3 (NFR-AVL-01…04), §12 (NFR-SEC-03/04, §12.2, §12.3), C1, RK-4, Appendix H.1/H.5; decisions D2, D6; Development Plan §3.4, §8.3 (supply chain, infrastructure), §10; T-M1-D04; TM-0001 F-03, F-06, F-07, F-09; ADR 0001–0009, ADR 0011, ADR 0012

## Context

- One codebase must serve four deployment models without forks (BRD §15): regional multi-tenant (R1), dedicated single-tenant (R3), in-country KSA/UAE (R3), customer-hosted (R4). Government and banks are Year-1 targets (D2); the stack is Next.js + Supabase, self-hostable (D6).
- In-country deployments require all data, backups, logs and AI inference in-country, NCA ECC/CCC alignment (KSA) and UAE government requirements; each external service needs an in-country or self-hosted alternative.
- The Development Plan requires the walking skeleton to run on a self-hosted stack in M1 and CI to build container images and smoke-test them every milestone (§10).

## Options considered

1. **Vercel + Supabase cloud only; sovereign later as a port** — fastest now; high risk of hidden vendor dependencies (RK-4).
2. **Containers everywhere from day one** (no Vercel) — maximum parity, but gives up Vercel's previews and managed edge for the regional product.
3. **Same artifacts, two hosting profiles:** Vercel + Supabase cloud for regional SaaS; container images + self-hosted Supabase components for all other models; **parity enforced by CI** — chosen.

## Decision

### 1. Deployment models
| Model | Web | Worker (≥ 2) + ClamAV + PDF renderer + Collector | Database & Supabase services | Release |
|---|---|---|---|---|
| Regional SaaS | Vercel, region `fra1` | Container host in Frankfurt (PO-approved provider) | Supabase cloud `eu-central-1` (Postgres, Auth, Storage, Realtime, Supavisor) | R1 |
| Dedicated | Own Vercel project or containers, region per contract | Containers | Separate Supabase project **or** self-hosted stack | R3 |
| In-country (KSA/UAE) | Containers on Kubernetes in an approved local cloud region (candidate providers are evaluated in the R2 sovereign-staging track; CST/NCA status to be verified) | Containers | Self-hosted stack (§3) | R3 |
| Customer-hosted | Same Helm chart on the customer's Kubernetes | Same | Self-hosted stack or customer-managed PostgreSQL meeting §3 prerequisites | R4 |

Tenant data location is recorded per tenant (`platform.tenants.data_residency`) and shown in the platform console (BRD §15).

### 2. Container images
- `suite-web`: Next.js `output: 'standalone'` (with `outputFileTracingRoot` at the monorepo root), copying `public/` and `.next/static`; runs `node server.js` as non-root on a distroless/slim Node 24 base.
- `suite-worker`: same build, worker entrypoint (ADR 0005); the only image that receives worker/service credentials.
- `pdf-renderer`: headless Chromium + bundled fonts, no credentials, no database/Storage access, egress blocked (ADR 0006 §6, TM-0001 F-06).
- `suite-migrate`: runs `supabase/migrations` + graphile-worker schema migrations as a one-off job before rollout.
- Self-hosting requirements for Next.js: identical `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` and build/deployment id across replicas (server-action encryption and version-skew handling); no reliance on Vercel-only ISR/data-cache behavior for tenant data (tenant pages render dynamically; any cache is tenant-keyed; a shared `cacheHandler` is added only if multi-replica caching is needed — verify with Next.js 16 self-hosting docs); image optimization via bundled `sharp`.
- Images are built once per release in CI, scanned (Trivy/Grype), **signed** (cosign/Sigstore, keyless in CI or KMS-backed key for air-gapped verification), with an SBOM (Syft, SPDX) per image (Plan §8.3). Deployments reference digests, not tags.

### 3. Self-hosted Supabase components (versions pinned per release)
| Component | Needed | Notes |
|---|---|---|
| PostgreSQL (Supabase Postgres image) | Yes | Extensions used: `pgcrypto`, `pg_trgm`, `btree_gist`, `ltree`, `pg_stat_statements`; `vector` from R2 (ADR 0012); `pg_cron`/`pg_net` not required (production uses the worker daemon, ADR 0005). Supabase roles/schemas (`auth`, `storage`, `realtime`, `anon`, `authenticated`, `service_role`, `supabase_auth_admin`) plus our `app_server`, `app_worker`, `app_queue` |
| GoTrue (Auth) | Yes | Email/password, TOTP MFA, **custom access token hook** (`pg-functions://…` configuration), asymmetric JWT signing keys, SAML (R2) — all to be verified in the T-M1-D04 spike (ADR 0002/0003) |
| Storage API | Yes | S3-compatible in-country backend (cloud object storage or self-hosted S3 service; check licence/maintenance status of MinIO at selection time); `imgproxy` not required (ADR 0006) |
| Realtime | Yes | Private channels with RLS authorization (in-app notifications, rosters) |
| Pooler | Yes | Supavisor (or PgBouncer) — transaction mode for web, session/direct connections for worker LISTEN (ADR 0005) |
| API gateway (Kong in the Supabase compose) | Yes | Routes `/auth`, `/storage`, `/realtime`; TLS termination at the ingress |
| PostgREST (Data API) | Optional | Not used by the app (tenant schemas are not exposed, ADR 0002); omit unless another component requires it — verify |
| Studio, postgres-meta | Optional | Admin network only, SSO-protected, or omitted in production |
| Edge Functions, Logflare/Analytics | No | Not used (ADR 0005, ADR 0009) |

Other services in every sovereign stack: `clamd`, `pdf-renderer`, OTel Collector + Grafana stack + GlitchTip + Gatus (ADR 0009), SMTP relay/local SMS gateway (ADR 0008), in-country AI endpoint (ADR 0012, R2+). Maps: R1 stores map links only (no embedded map SDK); prayer times and Hijri are computed locally (ADR 0007).

### 3a. Self-hosted parity spike (T-M1-D04) — explicit pass/fail list (TM-0001 F-09)
| Capability | Used by | Pass criterion | Fallback if it fails |
|---|---|---|---|
| Custom access token hook incl. `session_id` in hook input | ADR 0002 §3, §6a | Claims `tenant_id`/`person_id` issued per session on self-hosted GoTrue | **Blocker** — pin/upgrade GoTrue until it passes; no production without it |
| Asymmetric JWT signing keys (JWKS, `kid`) | ADR 0003 `getClaims()` | Tokens verifiable locally against JWKS; key rotation with overlap works | HS256 shared secret held only server-side **and** `getUser()` on every request (latency cost measured) |
| New API keys (publishable/secret) | Server Auth/Storage clients | Secret key accepted by Auth/Storage/Realtime; legacy keys disabled | Legacy `anon`/`service_role` JWT keys with rotation procedure |
| TOTP MFA + `aal` claim | ADR 0003 | Enrol/verify, AAL2 in claims | **Blocker** |
| Password/MFA verification-attempt hooks (lockout, FR-IAM-13) | ADR 0003, TM-0001 F-10 | Hooks invoked on self-hosted | Server-side sign-in wrapper with our own attempt counters (already required, ADR 0003 §2) |
| Leaked-password check | ADR 0003 (NFR-SEC-01) | Works without outbound internet | Offline breached-password corpus (k-anonymity hash ranges hosted in-country) checked in the sign-up/reset server action |
| SAML SSO (R2) | FR-IAM-10 | SAML IdP login with attribute mapping | OIDC through an in-country IdP broker (e.g., Keycloak) — verify |
| Realtime Authorization (private channels, RLS) | ADR 0008 §8 | Unauthorized topic subscription rejected | Server-sent events or polling from the app for the inbox (degraded latency) |
| Storage signed upload URLs (+ TUS) | ADR 0006 §3 | Direct browser upload of 200 MB via signed URL | Standard single-request signed upload (no resume) |
| Supavisor session/transaction modes | ADR 0002 §5, ADR 0005 | Web (transaction) and worker LISTEN (session) both work | PgBouncer + direct connection for the worker |

Results are recorded in the spike report and re-run on every Supabase component upgrade (§8).

### 4. Infrastructure as code
- `infra/docker/` — Docker Compose for local development, CI parity tests and demos (derived from Supabase's self-hosting compose, pinned).
- `infra/helm/jadarat/` — Helm chart (web, worker, migrate job, clamd, collector; Supabase components via pinned community charts or our own templates — maturity evaluated in the R2 sovereign-staging spike). PostgreSQL HA via an operator (e.g., CloudNativePG) or a provider-managed PostgreSQL that allows the required extensions and roles — decided per provider in R2.
- `infra/terraform/` — **OpenTofu** modules per target cloud (network, Kubernetes, object storage, KMS, DNS) and for regional SaaS configuration where providers exist (Vercel, Supabase — verify provider coverage). GitOps (Argo CD or Flux) for in-country clusters; changes via reviewed PRs (Plan §8.3).

### 5. Secrets and keys
- Runtime secrets are injected as environment variables from the platform: Vercel/GitHub encrypted env (regional), Kubernetes Secrets populated by External Secrets Operator from the in-country KMS/secret manager or HashiCorp Vault/OpenBao (sovereign). Never baked into images.
- **Application-level envelope encryption** (NFR-SEC-03/04) for connector credentials, provider keys, BYOK AI keys, national IDs and bank details: AES-256-GCM data keys, wrapped by a KEK in KMS/Vault Transit (or HSM where required); ciphertext + key id in PostgreSQL; rotation by re-wrapping. Implemented in `platform-core/crypto` with a KMS adapter per deployment. Supabase Vault is not relied upon for portability (verify if revisited).
- **Per-purpose key separation:** no key is used for more than one purpose; derived keys use HKDF with a purpose label from a purpose-specific master. Every signed token/MAC carries a key identifier (`kid`) so keys can rotate with an overlap window. Keys differ per environment and per deployment.

**Key inventory** (TM-0001 F-07; owner = Tech Lead unless stated; rotation also on suspected compromise)
| Key | Purpose | Algorithm | Store | Rotation / overlap |
|---|---|---|---|---|
| Auth JWT signing keys | Access tokens (ADR 0003) | Asymmetric (ES256/RS256), `kid` in JWKS | GoTrue config from secret manager/KMS | Yearly; previous public key stays in JWKS ≥ max token lifetime + refresh window |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Encrypts server-action closures/ids | AES-256 (Next.js) | Secret manager → env | **Identical across all web instances of one deployment**, different per deployment; rotated only at a full rollout |
| Envelope KEKs (one per purpose: connector/provider secrets, PII fields, BYOK AI keys) | Wrap data keys (NFR-SEC-03/04) | AES-256-GCM (KMS/HSM key) | Cloud KMS / Vault Transit / HSM (in-country for sovereign) | Yearly; re-wrap data keys in a background job; old KEK kept for decrypt until re-wrap completes |
| Data keys (DEKs) | Encrypt fields/secrets | AES-256-GCM | Wrapped next to ciphertext (`key_id`) | On KEK rotation or per policy |
| National-ID blind-index key | HMAC for uniqueness/search of encrypted national IDs | HMAC-SHA256 | Secret manager/KMS, separate from all other HMAC keys | Only with a planned re-index job (recompute all hashes); owner Security Lead |
| QR check-in key | Rotating QR tokens (FR-ATT-02) | HMAC-SHA256, per session-day key via HKDF, `kid` | Secret manager → worker/web env | Monthly; overlap = one QR window (≤ 120 s) |
| Action/approval link key | Signed single-use links (ADR 0008) — tokens are random and stored hashed; key only for the envelope MAC | HMAC-SHA256, `kid` | Secret manager | Quarterly; overlap = longest link lifetime (≤ 7 days) |
| Outbound webhook secrets (R2) | Signing per subscription (ADR 0011 §6) | HMAC-SHA256, random 256-bit per subscription | `platform.tenant_secrets` (envelope-encrypted) | On tenant request; 24 h overlap with dual signatures |
| Inbound webhook secrets (LMS, providers) | Verify partner signatures | Per partner spec | `platform.tenant_secrets` / secret manager | Per partner procedure |
| Log `actor_ref` key | Pseudonymous actor ids in logs (ADR 0009) | HMAC-SHA256 | Secret manager | Yearly; no overlap needed |
| Database login passwords (`app_server`, `app_worker`, `app_queue`) | DB access | SCRAM-SHA-256 | Secret manager | Quarterly; rolling restart after change |
| Supabase secret/service key | Worker-only Storage/Auth admin operations | Supabase API key | Secret manager → worker env only | Yearly (verify rotation without downtime) |
| Object-storage credentials, backup encryption keys | Storage backend, backups | Provider / AES-256 | In-country KMS | Yearly; owner DevOps |
| Image-signing key | cosign signatures | ECDSA (KMS-backed) | KMS | Yearly; owner DevOps |

### 6. Backups and recovery (in jurisdiction)
- Regional SaaS: Supabase PITR (≥ 7 days Starter/Professional, 30 days Enterprise — NFR-AVL-03) plus a daily logical backup to EU object storage in a separate account; Storage objects backed up/replicated in the EU.
- Self-hosted: continuous WAL archiving + base backups (pgBackRest, WAL-G or the operator's Barman integration) to encrypted in-country object storage in a separate account/bucket → RPO ≤ 15 min, PITR 7/30 days; object-storage versioning + replication in-country; backups encrypted with in-country keys.
- Restore drills: per release on sovereign staging (from R2) and the M7 DR drill (RTO ≤ 4 h / ≤ 1 h Enterprise, NFR-AVL-02).

### 7. Parity testing (CI)
- Every PR: build `suite-web`/`suite-worker` images (no push).
- Nightly on `main` and required on release branches (every milestone gate, Plan §10): start `infra/docker` compose (self-hosted Supabase + clamd + Mailpit + collector), apply migrations and synthetic seed, run the **sovereign smoke suite** with Playwright: sign-in with TOTP MFA (access-token hook claim present), tenant resolution by host, Arabic RTL shell, audit event written, event → worker → in-app notification via Realtime, upload EICAR → quarantined, e-mail captured by Mailpit, scheduled task executed. The same suite runs against the Vercel preview.
- A lint/test forbids imports of Vercel-only SDKs (`@vercel/kv`, `@vercel/blob`, `@vercel/edge-config`, Vercel Queues, …) outside optional adapters; Vercel Cron is allowed only as the preview-environment tick trigger (ADR 0005 §1).
- A configuration test asserts that the production web environment contains none of the worker-only secrets (ADR 0005, TM-0001 F-03).

### 8. Upgrade process
- Versioned releases (`suite` semver); a release bundle = image digests + migrations + Helm chart version + compatibility matrix of pinned Supabase component versions.
- **Expand/contract migrations** for zero-downtime deploys (NFR-AVL-04): release N adds (expand) and is backward compatible with N-1 code; destructive changes (contract) ship in N+1 or later (migration conventions).
- Order: verified backup → `suite-migrate` → rolling update of worker then web → smoke tests → (next release) contract. Rollback = redeploy previous digests (compatible thanks to expand/contract) + point-in-time recovery only as last resort.
- Rollout: regional SaaS first; sovereign/dedicated after a soak period in a maintenance window announced ≥ 72 h ahead; supported window for sovereign customers N and N-1. Supabase component upgrades are rehearsed on sovereign staging before production. Customer-hosted (R4) receives signed bundles via a pull-based channel with ENTLAQA-managed updates.

## Consequences

**Positive:** sovereignty is proven continuously, not at R3; same artifacts everywhere; clear list of what must exist in-country.

**Negative / costs:** CI time and maintenance of the compose/Helm stacks from M1; regional SaaS also needs a container host; self-hosting Supabase components means owning their upgrades, HA and security patches in-country.

## Security impact
Signed images, SBOMs, digest pinning, secrets from KMS/Vault, application-level envelope encryption, in-jurisdiction backups and telemetry, admin surfaces (Studio) off the public network — covers Plan §8.3 "Supply chain" and "Infrastructure".

## Sovereign deployment impact
This ADR is the reference; every other ADR states its in-country alternative.

## Suite impact
New suite modules add no new deployables (modular monolith, ADR 0001) and ship through the same images, chart and parity suite.

## Verification
1. T-M1-D04: walking skeleton runs on `infra/docker` with the access-token hook, TOTP and asymmetric keys verified.
2. Nightly sovereign smoke suite green; release gates require it (Plan §10).
3. Image signing and SBOM presence checked at deploy time (admission policy in sovereign clusters).
4. Backup/restore drill evidence per release from R2; DR drill in M7.
