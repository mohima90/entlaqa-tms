# Security, Privacy & Compliance Risk Register

| | |
|---|---|
| **Backlog** | T-M1-C03 |
| **Version** | 0.1 — 30 Sep 2026 |
| **Owner** | Security Lead (Claude agent); accepted risks signed off by the Product Owner |
| **Scope** | Security, privacy and regulatory-compliance risks of the Jadarat Platform and Jadarat TMS. Delivery/business risks stay in the RAID log (Development Plan §11) and BRD §18; overlaps are cross-referenced (RK-n). |
| **Sources** | [TM-0001](threat-models/TM-0001-platform.md) (threats T-nn, findings F-nn), BRD v2.1 §12, §15, App. E; Development Plan §8 |

> Regulatory statements below summarize BRD Appendix E and public information as of September 2026. **Every legal interpretation must be validated by counsel** (BRD C4); items marked "verify with counsel" are not legal advice.

---

## 1. Method

**Likelihood (L)** — 1 Rare · 2 Unlikely · 3 Possible · 4 Likely · 5 Almost certain (within 12 months, without further treatment).
**Impact (I)** — 1 Negligible · 2 Minor (single user, no regulatory effect) · 3 Moderate (single tenant, limited personal data, contractual breach) · 4 Major (C4 data breach of one tenant, regulator notification, GA delay) · 5 Severe (cross-tenant exposure, many tenants affected, loss of government/bank segment, licence or market ban).
**Score** = L × I (inherent, i.e., with controls currently *implemented* — at M0/M1 almost none are). Bands: **1–4 Low · 5–9 Medium · 10–16 High · 20–25 Critical**.
**Target** = expected residual score after the planned mitigation.

**Status** — *Open* (identified, treatment not started) · *Treating* (mitigation in progress) · *Monitoring* (treated; watching indicators) · *Accepted* (residual accepted by PO + Security, with date) · *Closed*.

**Review cadence** — every milestone gate at minimum; risks scored ≥ 15 are reviewed every 2 weeks; the date shown is the next scheduled review. Owner roles follow the agent-team model (Development Plan §2.3): human-only actions (legal, contracts, accounts, pen test) are owned by the PO.

---

## 2. Heat map (inherent)

| L \ I | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| **5** | | | | | R-09 |
| **4** | | | R-07, R-14, R-15, R-22 | R-05, R-10, R-16, R-19, R-28 | R-01, R-04, R-12 |
| **3** | | | R-17, R-21, R-25, R-30 | R-02, R-06, R-08, R-11, R-13, R-18, R-20, R-23, R-24, R-26, R-27, R-29, R-31 | R-03 |
| **2** | R-33 | | | R-32 | |
| **1** | | | | | |

---

## 3. Register

| ID | Risk description | Category | L | I | Score | Target | Owner | Mitigation (planned or in place) | Status | Review date |
|---|---|---|---|---|---|---|---|---|---|---|
| R-01 | **Cross-tenant data exposure** through an RLS gap, a wrong policy, a `security definer` function, a cache keyed without tenant, or a job running under the wrong tenant context (TM T-14, T-24, T-28, T-32) | Security — tenant isolation | 4 | 5 | 20 | 5 | Tech Lead | ADR-0002 restrictive `tenant_isolation` + FORCE RLS + composite FKs; CI catalog check + pgTAP isolation tests per table (gate 5); E2E J13; tenant-keyed caches (SCS-17); cross-tenant exposure = S1 | Treating | 2026-10-14 |
| R-02 | **Database-level claim forgery** if the `app_server` credential leaks: a direct pooler connection can set any tenant's claims (TM T-33, F-01) | Security — tenant isolation | 3 | 4 | 12 | 4 | Tech Lead | Vault-held credential, rotation, per-env credentials, pooler network restriction, connection alerts; F-01 (claims validated against live `auth.sessions` + active membership; worker role separation) | Open | 2026-10-14 |
| R-03 | **Broken authorization / data-scope bypass** (missing `defineAction`, wrong resource-scope mapping, IDOR) (TM T-54, T-55, T-56) | Security — authorization | 3 | 5 | 15 | 5 | Tech Lead | ADR-0003 single wrapper + lint gate; positive and negative tests per action (403/404/AAL2); `scopeFilter`; security-review pass on RBAC PRs | Treating | 2026-10-14 |
| R-04 | **Account takeover of privileged users** (Tenant Admin, HR, platform staff) via phishing, credential stuffing or session theft (TM T-01, T-02, T-58, T-59) | Security — authentication | 4 | 5 | 20 | 6 | Tech Lead | TOTP MFA with AAL2 for high-risk permissions; breached-password check; lockout and rate limits; HttpOnly host-only cookies; 15-min tokens with rotation; secure e-mail/password change settings; phishing-resistant MFA for platform staff | Treating | 2026-10-14 |
| R-05 | **Saudi PDPL cross-border transfer**: regional SaaS in Frankfurt (Vercel `fra1`, Supabase `eu-central-1`) plus sub-processors (e-mail, error tracking, AI) process KSA personal data outside the Kingdom; transfers require an approved safeguard (e.g., SDAIA standard contractual clauses) and a transfer risk assessment (BRD §12.2, FR-DEP-01) | Compliance — privacy | 4 | 4 | 16 | 6 | PO + Legal counsel | Execute SDAIA SCCs + transfer risk assessment before the first Saudi tenant; DPA and sub-processor list with locations; data minimization in third-party payloads; in-country offering (R3); per-tenant data-location record (BRD §15); breach notification procedure (see R-24) | Open | 2026-10-31 |
| R-06 | **NCA CCC / ECC for government and CNI tenants**: government data must stay in-Kingdom and deployments need control evidence (CCC-2:2024); a government entity could self-sign-up to the regional SaaS (BRD App. E, FR-DEP-03) | Compliance — regulatory | 3 | 4 | 12 | 4 | PO + Security Lead | Sector declaration at sign-up and block/route government entities to the sovereign offering; CCC/ECC control mapping started at R2 with evidence collection automated from CI (gates, SBOM, access reviews); CST-registered hosting partner (BRD §12.3) | Open | 2026-11-30 |
| R-07 | **Egypt PDPL (Law 151/2020) grace period ends ~2 Nov 2026** (Executive Regulations, Decree 816/2025, effective 2 Nov 2025 with one-year grace). Obligations such as licensing/permits from the Personal Data Protection Centre, DPO appointment and cross-border transfer conditions may apply to ENTLAQA as controller/processor before any Egyptian tenant is onboarded (verify with counsel) | Compliance — privacy | 4 | 3 | 12 | 4 | PO + Legal counsel | Legal assessment of ENTLAQA's role and required permits **before 2 Nov 2026**; decide whether Egyptian tenants are onboarded at R1 GA; transfer mechanism for Egyptian data hosted in Frankfurt; DPO designation | Open | 2026-10-15 |
| R-08 | **UAE PDPL and government-cloud rules**: Federal Decree-Law 45/2021 excludes government data, which falls under Cloud-First/ISR-type requirements; free-zone regimes (DIFC, ADGM) differ; implementing details to be confirmed (verify with counsel) | Compliance — privacy | 3 | 4 | 12 | 4 | PO + Legal counsel | Jurisdiction matrix per tenant (country, free zone, government flag); UAE government only on in-country deployments (R3); DPA clauses per regime | Open | 2026-11-30 |
| R-09 | **Software supply-chain compromise** (malicious npm release or worm, typosquat, compromised GitHub Action, poisoned base image) executing in CI or at runtime (TM T-22) | Security — supply chain | 5 | 5 | 25 | 8 | DevOps (Claude) | Lockfile + frozen installs; lifecycle scripts only for allow-listed packages; minimum release age; Actions pinned by SHA; least-privilege tokens + OIDC; OSV scan, licence check, secret scan (gates 1, 11, 12); SBOM + signed images (gate 13); Renovate with review | Treating | 2026-10-14 |
| R-10 | **AI misuse (R2+)**: prompt injection via tenant content, over-privileged tools, cross-tenant retrieval, data sent to providers outside jurisdiction or used for training, hallucinated actions, cost abuse (TM T-63, T-51; BRD RK-6) | Security / privacy — AI | 4 | 4 | 16 | 6 | Security Lead | ADR-0012: tools = `defineAction` with user scope; confirmation for writes; retrieval under RLS; untrusted-content handling; output sanitization; zero-retention/no-training contract terms; regional/sovereign model endpoints; per-tenant budgets; AR/EN red-team suite; AI features opt-in (BRD §6.23) | Open | 2027-03-31 |
| R-11 | **Insider / platform-staff abuse** (impersonation misuse, direct DB access, support data exports) (TM T-07, T-30) | Security — insider | 3 | 4 | 12 | 4 | PO + Security Lead | No standing tenant access; signed time-limited grants with reason + ticket; two-person approval for government/bank tenants; tenant-visible banner and audit; restricted actions; break-glass DB access with logging; quarterly access reviews; background checks per HR policy | Open | 2026-11-30 |
| R-12 | **AI coding agents introduce vulnerabilities or leak secrets** (agent follows injected instructions from repo/issue/dependency content; insecure patterns at scale) — specific to the delivery model in Plan §2.3 (TM T-23) | Security — SDLC | 4 | 5 | 20 | 6 | Tech Lead + PO | PO-only merge; separate code-review and security-review passes; CODEOWNERS on security paths; CI gates non-bypassable; agents have no production credentials; secure coding standard + PR checklist; Semgrep rules for project-specific patterns | Treating | 2026-10-14 |
| R-13 | **Secrets and keys exposure** (service-role/secret key, `app_server` URL, HMAC/KMS keys) via env misconfiguration, client bundle, logs, previews (TM T-38, F-03, F-07) | Security — secrets | 3 | 4 | 12 | 4 | DevOps (Claude) | Vault/KMS; `server-only`; env schema validation; gitleaks; bundle scan; worker credentials only in the `worker` container — no production tick mode on Vercel (ADR-0005, F-03); envelope encryption and rotation (ADR-0010 §5) plus key inventory (F-07) | Open | 2026-10-31 |
| R-14 | **Attendance fraud** (QR relay, GPS spoofing) undermines regulatory evidence (e.g., HRDF Tamheer absence rule) (TM T-09, T-25; BRD RK-7) | Integrity — regulatory evidence | 4 | 3 | 12 | 8 | PO | Rotating signed QR; authenticated per-learner check-in; geo-fence; instructor review of out-of-range; e-signature (R2), anomaly detection (R3); residual accepted and disclosed to tenants | Treating | 2027-01-31 |
| R-15 | **Public-endpoint abuse**: certificate verification scraping, sign-up bots, enumeration, SMS pumping (TM T-11, T-12, T-36) | Security — anti-automation | 4 | 3 | 12 | 4 | Tech Lead | Random verification codes; PostgreSQL rate limiter (ADR-0011 §4) incl. in front of Auth sign-in/OTP; self-hostable bot challenge (F-05); SMS country allow-lists; uniform responses; spend alerts | Open | 2026-11-30 |
| R-16 | **Stored XSS via tenant-controlled content**, including attacks on platform staff in the console (TM T-40) | Security — web | 4 | 4 | 16 | 4 | Tech Lead | React escaping; `dangerouslySetInnerHTML` banned except sanitized component; nonce CSP; text-only console rendering; DAST | Treating | 2026-11-30 |
| R-17 | **SSRF** through connector/webhook/LRS URLs, PDF rendering or image optimizer into internal services (TM T-39, T-61) | Security — web | 3 | 3 | 9 | 3 | Tech Lead | `safeFetch` with DNS pinning and private-range blocking; egress proxy (sovereign); sandboxed PDF renderer (F-06); restricted `images.remotePatterns` | Open | 2027-01-31 |
| R-18 | **Malware or active content via uploads** (materials up to 200 MB, evidence, imports) (TM T-26, T-27, T-41) | Security — files | 3 | 4 | 12 | 4 | Tech Lead | Quarantine + malware scan; magic-byte type checks; attachment disposition; image re-encoding; importer limits | Open | 2027-01-31 |
| R-19 | **Personal-data leakage to logs, error tracking, analytics** or via restricted fields in exports/audit diffs (TM T-35, T-37) | Privacy | 4 | 4 | 16 | 4 | Tech Lead | Redacting logger; PII-off error tracking in the same region; field classification registry; DTO projection used by exports/reports/audit | Treating | 2026-11-30 |
| R-20 | **Sovereign parity gaps**: self-hosted Supabase may lack features used for security in cloud (asymmetric JWT keys, new API keys, SAML, hooks, leaked-password check needing internet egress, Realtime Authorization), leading to a weaker in-country posture (TM F-09; BRD RK-4) | Security — deployment | 3 | 4 | 12 | 4 | DevOps (Claude) | T-M1-D04 spike with pass/fail list; fallbacks documented in ADR-0010; same CI gates run against the self-hosted stack every milestone (Plan §10) | Open | 2026-11-30 |
| R-21 | **Sub-processor and vendor risk**: data location/retention of Vercel logs, Supabase, e-mail/SMS/WhatsApp providers, error tracking, AI providers not yet documented; DPAs not signed | Compliance — third party | 3 | 3 | 9 | 3 | PO | Sub-processor register (name, service, data, region, DPA, transfer mechanism); vendor security review; region pinning; publish list (BRD §12.2) before first paying tenant | Open | 2026-12-31 |
| R-22 | **Noisy-neighbour DoS and denial of wallet** (reports/exports/imports, messaging and AI spend) (TM T-48, T-51) | Availability / cost | 4 | 3 | 12 | 4 | Tech Lead | Per-tenant quotas and concurrency limits; statement timeouts; async jobs; edition caps (FR-SUB-01); cost-anomaly alerts (NFR-OBS-02); k6 tests from M5 | Open | 2027-02-28 |
| R-23 | **Framework zero-day** (Next.js/React/Supabase/PostgreSQL) needing emergency patching, with sovereign/customer-hosted deployments patching slower (TM T-62) | Security — vulnerability management | 3 | 4 | 12 | 6 | DevOps (Claude) | Patch SLAs (README); advisory monitoring; defense in depth (authz not in proxy); update channel and SLA in sovereign contracts; WAF virtual patching | Open | 2026-11-30 |
| R-24 | **Breach notification readiness**: no incident-response plan yet; PDPL-type laws impose short regulator/customer notification windows (e.g., 72 hours where applicable, NFR-SEC-10) | Compliance — incident response | 3 | 4 | 12 | 4 | Security Lead + PO | Incident response plan and runbooks (S1 cross-tenant playbook); contact matrix per jurisdiction/regulator; tabletop exercise before GA; customer notification templates AR/EN | Open | 2027-01-31 |
| R-25 | **Backup and restore risks**: backups contain all tenants; single-tenant restore could mix data; backups outside jurisdiction (TM T-43; NFR-AVL-03) | Security / availability | 3 | 3 | 9 | 3 | DevOps (Claude) | Encrypted in-jurisdiction backups; restricted access; tenant-level restore via export/import procedure; restore drills (G7) | Open | 2027-03-31 |
| R-26 | **Bank tenants' outsourcing/cloud requirements** (e.g., SAMA outsourcing rules and regulator non-objection for material outsourcing or data outside KSA) not met by regional SaaS (verify with counsel) | Compliance — sector | 3 | 4 | 12 | 4 | PO + Legal counsel | Bank segment offered dedicated/in-country deployment (FR-DEP-02/03); security questionnaire pack; right-to-audit clauses; mapping to customer control frameworks | Open | 2026-12-31 |
| R-27 | **Sensitive-data handling**: health information in absence evidence, photos/recordings, national IDs/Iqama and restricted demographics mishandled (classification, encryption, retention, consent) (TM A-01…A-05) | Privacy | 3 | 4 | 12 | 4 | Security Lead | Classification C4 with field-level encryption and blind index; consent capture (FR-AUD-05); retention policies (FR-AUD-03); access audit; DPIA for attendance geo and AI features | Open | 2026-12-31 |
| R-28 | **Platform used for phishing / brand impersonation** (trial tenants squatting bank/government names, malicious invitation templates sent from ENTLAQA's domain, custom-domain hijack) (TM T-13, T-64) | Security — abuse | 4 | 4 | 16 | 6 | PO + Tech Lead | Reserved names; trial send quotas; template link restrictions; SPF/DKIM/DMARC; abuse desk and suspension procedure; DNS verification for custom domains | Open | 2026-11-30 |
| R-29 | **Audit-log integrity vs. erasure and retention**: immutable logs containing personal data conflict with erasure requests (FR-AUD-04) and 10-year retention (DR-5); operator-level tampering (TM T-19, F-08) | Compliance / integrity | 3 | 4 | 12 | 4 | Tech Lead | Append-only design + hash chain + external anchor; crypto-shredding or redaction for C4 values in diffs; legal review of retention vs. erasure | Open | 2026-12-31 |
| R-30 | **Certification evidence gap** for ISO/IEC 27001 (12 months after GA), SOC 2 Type II (18 months) and NCA controls if evidence is not collected from the start (BRD §12.3) | Compliance — assurance | 3 | 3 | 9 | 3 | PO + Security Lead | Control library mapped to ASVS/ISO Annex A; automated evidence from CI and access reviews; policies drafted during R1 | Open | 2027-03-31 |
| R-31 | **Independent validation dependency**: pen-test vendor not yet booked (needed by M5 for M7); bug bounty after GA (Plan §8.2, §11) | Assurance | 3 | 4 | 12 | 3 | PO | Shortlist in M0 (Plan §6.2); book by M5; scope from this threat model; retest evidence for G7 | Open | 2027-01-31 |
| R-32 | **Non-production environments with production data or secrets** (previews connected to staging/prod, copies of tenant data for debugging) | Privacy / security | 2 | 4 | 8 | 2 | DevOps (Claude) | Separate Supabase projects per environment; synthetic seed data only (ADR-0001 `supabase/seed/`); preview protection; production data never copied down; sandbox tenants without personal data (FR-ADM-15) | Open | 2026-11-30 |
| R-33 | **Unpatched dev-time dependency** `braces` ≤ 3.0.3 ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), high, stack-exhaustion DoS on deeply nested brace patterns); no patched release exists. Path: `@jadarat/config` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces` | Supply chain | 2 | 1 | 2 | 1 | DevOps (Claude) | Reached only by lint tooling (the plugin globs the constant `rootDir` from our ESLint config; worst case: a lint/CI run crashes); `@jadarat/config` is consumed only as a devDependency, so `braces` is not in the production build (`apps/suite/.next/standalone` has none). **Accepted by the PO (3 Oct 2026)** as a single-advisory exception in `pnpm-workspace.yaml` (`auditConfig.ignoreGhsas`); gate 11 still fails on every other high/critical advisory. At each review also confirm `pnpm --filter @jadarat/suite list --prod --depth Infinity` shows no `braces` (the exception silences the advisory on every path). Remove the exception when a patched `braces` (or a dependency path without it) is available | Accepted | 2026-11-03 |

---

## 4. Top risks (for the weekly status report, Plan §12)

1. **R-09** Supply-chain compromise (25)
2. **R-01** Cross-tenant data exposure (20)
3. **R-04** Privileged account takeover (20)
4. **R-12** AI coding agents introducing vulnerabilities (20)
5. **R-05** Saudi PDPL cross-border transfer on regional SaaS (16)
6. **R-10** AI misuse (16, R2+)
7. **R-16** Stored XSS incl. platform console (16)
8. **R-19** PII leakage to logs/exports (16)
9. **R-28** Phishing/brand abuse via trial tenants (16)
10. **R-03** Broken authorization / data scopes (15) — with **R-07** Egypt PDPL grace-period deadline (12, time-critical: 2 Nov 2026)

## 5. Change log

| Date | Change | By |
|---|---|---|
| 30 Sep 2026 | Register created (32 risks) from TM-0001 and BRD §12/§15/App. E | Security Lead (Claude) |
| 3 Oct 2026 | R-33 added: unpatched `braces` advisory in lint tooling; audit exception accepted by the PO | Security Lead (Claude) |
