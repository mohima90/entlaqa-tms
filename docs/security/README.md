# Security — Jadarat Platform & TMS

Home of the security program artefacts required by Development Plan §6.3 Track C and §8 (Secure Development Lifecycle). Everything here applies to every suite module built on the Jadarat Platform, not only the TMS.

## 1. Index

| Document | Purpose | Backlog | Status |
|---|---|---|---|
| [threat-models/TM-0001-platform.md](threat-models/TM-0001-platform.md) | Platform threat model: assets and classification, actors, trust boundaries, data-flow diagram, STRIDE (65 threats), abuse cases, residual risks, findings for the ADRs (F-01…F-13) | T-M1-C01 | Proposed v0.1 |
| [threat-models/TM-0002-tenancy-onboarding.md](threat-models/TM-0002-tenancy-onboarding.md) | `EP-M2-TEN` tenancy & onboarding: self sign-up and provisioning, host → tenant resolution, org structure, custom fields, editions, platform console (39 threats T-TEN-nn, findings F-TEN-01…11) | T-M1-C02 | Proposed v0.1 |
| [threat-models/TM-0003-identity-roles.md](threat-models/TM-0003-identity-roles.md) | `EP-M2-IAM` identity & roles: sign-in anti-automation, invitations, password reset, MFA policy, sessions, role assignment, bulk import (44 threats T-IAM-nn, findings F-IAM-01…08, PO decisions D-IAM-01…04) | T-M1-C02 | Proposed v0.1 |
| [threat-models/TM-0004-people-directory.md](threat-models/TM-0004-people-directory.md) | `EP-M2-PEO` people directory & suite mode: manager hierarchy and scopes, restricted fields, national IDs, HR intake, data-subject requests (30 threats T-PEO-nn, findings F-PEO-01…10) | T-M1-C02 | Proposed v0.1 |
| [threat-models/TM-0005-audit-consent.md](threat-models/TM-0005-audit-consent.md) | `EP-M2-AUD` audit & consent: audit completeness and tamper evidence, fail-closed policy, audit viewer/export, consent capture and enforcement (33 threats T-AUD-nn, findings F-AUD-01…06) | T-M1-C02 | Proposed v0.1 |
| [threat-models/TM-0006-shell-notifications.md](threat-models/TM-0006-shell-notifications.md) | `EP-M2-SHELL` suite shell, notifications, Hijri: global search, inbox/Realtime, approvals inbox, e-mail templates and sender identity, bidi spoofing, dates and time zones (32 threats T-SHL-nn, findings F-SHL-01…08) | T-M1-C02 | Proposed v0.1 |
| [risk-register.md](risk-register.md) | Security, privacy and compliance risk register (55 risks) incl. Saudi PDPL transfers, NCA CCC, Egypt PDPL deadline, supply chain, AI, insiders | T-M1-C03 | Proposed v0.1 |
| [asvs-l2-mapping.md](asvs-l2-mapping.md) | OWASP ASVS 5.0.0 Level 2 mapped to packages/ADRs, verification method and R1 applicability | T-M1-C04 | Proposed v0.1 |
| [secure-coding-standard.md](secure-coding-standard.md) | Mandatory coding rules for this stack with do/don't examples and the PR security checklist | T-M1-C05 | Proposed v0.1 |
| `threat-models/TM-0007…` | Per-epic threat models for M3–M6 and later (§4.1) | T-M1-C02 | Not started |
| `reviews/` | Security review records (per epic before build; per security-relevant PR; gate sign-off) — Plan §7.1 | ongoing | Created with the first review |

Related: ADRs in [`../adr/`](../adr/README.md) (each has a *Security impact* section); Development Plan §5.3 (CI gates), §5.4 (defect severity), §8 (security program).

## 2. Principles (Plan §8.1)

Secure by design · deny by default · least privilege · defense in depth · no secrets in code · privacy by design · everything auditable · verify continuously. Tenant isolation failures are always the highest severity (Plan Q2).

## 3. Severity definitions and remediation SLAs

### 3.1 Severity of security findings

Rate with **CVSS v4.0** base score where practical (CVSS v3.1 is acceptable when a tool only emits v3.1), then apply the Jadarat overrides, which always win over the score.

| Severity | CVSS | Jadarat overrides — always at least this severity | Maps to defect class (Plan §5.4) |
|---|---|---|---|
| **Critical** | 9.0–10.0 | Any cross-tenant read or write (Plan Q2); authentication bypass; remote code execution; exposure of platform secrets or signing keys (service-role/secret key, `app_server` credential, JWT/HMAC/KMS keys); mass exposure of C4 data (national IDs/Iqama, restricted demographics, geo-location, signatures) | **S1** |
| **High** | 7.0–8.9 | Stored XSS; authorization bypass or IDOR within a tenant exposing C3/C4 data or allowing privileged actions; privilege escalation to Tenant Admin; SSRF reaching internal services; MFA bypass; forgery of regulatory evidence (attendance, certificates) at scale | **S2** |
| **Medium** | 4.0–6.9 | Reflected XSS requiring significant interaction; missing rate limit on a non-critical endpoint; information leakage without personal data; weak security header on a sensitive page | **S3** |
| **Low** | 0.1–3.9 | Best-practice deviations with no demonstrated exploit path | **S4** |

Data classes (C1–C4) are defined in TM-0001 §2.

### 3.2 Remediation SLAs

| Severity | Triage (confirm and assign) | Remediation target in production | Release rule |
|---|---|---|---|
| **Critical** | ≤ 4 hours | **24 hours** — hotfix; incident process (NFR-SEC-10); customer/regulator notification assessed | Blocks every release; security veto at go/no-go |
| **High** | ≤ 1 working day | **3 working days** (see note) and in any case **before any release** | Blocks release (no open S2) |
| **Medium** | ≤ 5 working days | **30 days** | Allowed only with PO acceptance and a fix date |
| **Low** | ≤ 10 working days | **90 days** or documented risk acceptance signed by PO + Security Lead | Allowed |

**Note on High.** Development Plan §5.4 sets S2 (which includes high-severity vulnerabilities) at *≤ 3 working days*, while §8.4 sets High vulnerabilities at *7 days*. Until the PO aligns the Plan (TM-0001 finding F-11), **the stricter target (3 working days) applies**; a 7-day target may be used only for High findings in dependencies without a reachable code path, with Security Lead sign-off.

**Additional rules**
- **Clock:** starts when the finding is known to the team (tool alert, report, review), not when it is triaged.
- **Dependencies (CI gate 11):** the build fails on high/critical advisories with a fix available. Without a fix: record in the risk register, apply a compensating control (disable feature, WAF rule, config), re-check weekly; the SLA clock still runs.
- **Pre-production findings** (CI, review, pen test before GA) must be fixed before merge/release; the SLAs apply to anything that reached production or a customer deployment.
- **Sovereign and dedicated deployments:** a patched release is made available within the same SLA; installation timing in customer-hosted environments follows the contract (R4), which must reference these SLAs.
- **Accepted risks** carry an expiry date (maximum 6 months) and are listed in the risk register.
- **Metrics** (Plan §5.5): open findings by severity and age, mean time to remediate, SLA breaches — reported weekly.

## 4. Threat models: how they are maintained

### 4.1 Structure and naming

- `threat-models/TM-0001-platform.md` — cross-cutting platform model (this release baseline).
- One model **per epic** (Plan §7.1: "per epic before build"), numbered sequentially: `TM-NNNN-<epic-slug>.md`. Written or planned for R1 (T-M1-C02):

| ID | Epics (Plan App. G) | Focus beyond TM-0001 | Needed by | Status |
|---|---|---|---|---|
| TM-0002 | EP-M2-TEN | Sign-up and provisioning, host → tenant resolution, org structure, custom fields, editions, platform console | Start of M2 | Proposed v0.1 |
| TM-0003 | EP-M2-IAM | Sign-in anti-automation, invitations, password reset, MFA policy, sessions, roles/scopes, bulk import | Start of M2 | Proposed v0.1 |
| TM-0004 | EP-M2-PEO | Shared people directory, manager hierarchy as scope source, restricted fields, suite/standalone ownership | Start of M2 | Proposed v0.1 |
| TM-0005 | EP-M2-AUD | Audit completeness and tamper evidence, impersonation attribution, consent | Start of M2 | Proposed v0.1 |
| TM-0006 | EP-M2-SHELL | Global search, inbox and Realtime, approvals inbox, e-mail templates and sender identity, Hijri/time zones | Start of M2 | Proposed v0.1 |
| TM-0007 | EP-M3-CAT, EP-M3-SCH, EP-M3-RES, EP-M3-INS | Materials library, instructor portal (external users), calendar feeds | Start of M3 | Planned |
| TM-0008 | EP-M4-ENR, EP-M4-MGR, EP-M4-LRN, EP-M4-LOG | Approval links, manager scopes, learner PWA/offline cache, notifications | Start of M4 | Planned |
| TM-0009 | EP-M5-ATT, EP-M5-ASM, EP-M5-CRT | QR/geo check-in, assessments integrity, certificate designer/PDF, public verification | Start of M5 | Planned |
| TM-0010 | EP-M6-LMS, EP-M6-RPT | Connector framework, inbound webhooks, OAuth to LMS, SSRF, reports and exports | Start of M6 | Planned |
| TM-0011… | R2+: SSO/SCIM, public API & webhooks, AI features, WhatsApp, sovereign deployment | — | Before each epic | Planned |

### 4.2 Process

1. **Create before build.** The epic's threat model is written (template: Plan Appendix D, using the section structure of TM-0001) during backlog refinement, before the first story of the epic enters a sprint (Definition of Ready).
2. **Inherit, don't repeat.** Epic models cite platform threats by ID (e.g., "T-14, T-55 apply") and add only epic-specific items with an area prefix that never equals a bare BRD feature ID: threats `T-<AREA>-NN`, findings `F-<AREA>-NN`, PO decisions `D-<AREA>-NN`, abuse cases `AB-<AREA>-NN`, residual risks `RR-<AREA>-NN`, legal-validation items `L-<AREA>-NN` (areas so far: TEN, IAM, PEO, AUD, SHL). Feature IDs (`IAM-01`) and requirements (`FR-IAM-01`) keep their BRD form. Header fields, the L/I scale (risk register §1) and the status vocabulary (*Implemented* · *Partly implemented* · *Planned (Mx)* · *Open — decision <ID>*) are the same in every epic model; proposed register rows get their final `R-NN` when the register is updated.
3. **Stories carry the controls.** Each mitigation maps to a story or acceptance criterion; the story's *Security notes* (Plan Appendix C) list the threat IDs; every abuse case becomes at least one negative test.
4. **Review.** Security Lead + Tech Lead review the model (separate security-review pass, Plan §2.3); the record is saved as `reviews/SR-YYYYMMDD-<topic>.md` with scope, findings, decisions and sign-off.
5. **Verify.** A threat's status becomes *Verified* only when its verification (test, CI gate or review record) exists and passes. Gate checklists (Plan §7.2 "Security") require all threats of the milestone to be *Verified* or *Accepted*.
6. **Update triggers.** Update the relevant model (and bump its version) when: an ADR touching a trust boundary is accepted/superseded; a new entry point, data class, third party or deployment model appears; a security incident, pen-test or bug-bounty finding relates to it; before every milestone gate.
7. **Traceability.** Threat model ↔ risk register (R-nn) ↔ ASVS rows ↔ secure coding standard (SCS-n) ↔ tests. PRs that change a trust boundary tick the threat-model item in the PR security checklist (SCS-21).

### 4.3 Risk register cadence

Reviewed at every milestone gate; risks scored ≥ 15 every two weeks; top 5 reported in the weekly status report (Plan §12). New risks come from threat models, incidents, regulatory changes (BRD Appendix E — validated by counsel) and supplier changes.

## 5. Reporting a security issue

- **Team (PO and Claude sessions):** record findings as a backlog item labelled `security` with severity per §3.1, and note it in `docs/delivery/STATUS.md` blockers when Critical/High. Never paste secrets or personal data into issues, PRs or chat.
- **External (from GA):** `security.txt` and a disclosure address will be published with the bug-bounty programme (Plan §8.2 "Operate").
