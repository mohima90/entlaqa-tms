# ADR 0006 — File storage, signed URLs and malware scanning

**Status:** Accepted — PR #9, 30 Sep 2026; amended 20 Oct 2026 (PO decision: branding images are not virus-scanned — see the amendment at the end) · **Date:** 30 Sep 2026 · **Backlog:** T-M1-B06 · **Related:** BRD §3.4.1 (files service), FR-CAT-06, FR-ADM-07, FR-IAM-04, FR-INS-02, FR-CRT-01…06, FR-ATT-11, FR-LOG-01, FR-AUD-02/03, FR-SUB-01, NFR-SEC-08, DR-5, DR-6; Development Plan §8.3 (file uploads); TM-0001 F-06, F-13 (T-34, T-61); ADR 0001, ADR 0002 §8, ADR 0003 §4.4, ADR 0004, ADR 0005, ADR 0010

## Context

- R1 stores user uploads (materials ≤ 200 MB per file, logos, venue and profile photos, question media, qualification and external-certificate evidence, task evidence, scanned sign-in sheets, import files) and generated files (certificate PDFs, sign-in sheets, report exports).
- Requirements: private storage, type/size checks, virus scanning, signed expiring URLs, no inline execution of uploaded HTML/SVG (NFR-SEC-08, Plan §8.3); tenant isolation (ADR 0002 §8); storage limits per edition (SUB-01); training-record retention ≥ 10 years (DR-5).
- Browsers must upload directly to storage: a Vercel function request body is limited to about 4.5 MB (verify current limit), far below 200 MB.
- The browser never uses Supabase for authentication, but it holds a short-lived, in-memory access token for Realtime (ADR 0003 §4.4) that the Storage API would also accept; storage policies — not only server code — must therefore be safe (TM-0001 F-13, T-34).

## Options considered

1. **Supabase Storage** (S3-compatible backend, RLS on `storage.objects`, signed URLs, resumable uploads; self-hostable `storage-api` with S3 or file backend).
2. **Direct S3/object storage with presigned URLs** — portable, but authorization lives only in app code and we would duplicate what Storage already provides.
3. **Proxy all bytes through Next.js** — simplest authorization, but hits function body/duration limits and doubles bandwidth.

For scanning: **ClamAV (`clamd`) container** (open source, runs in-country, air-gap capable with a signature mirror) vs. commercial scanning APIs (data leaves the jurisdiction; not acceptable for sovereign tenants) vs. no scanning (violates NFR-SEC-08).

## Decision

Supabase Storage (option 1) behind the `platform-files` package, with metadata in `platform.files` and ClamAV scanning in the worker (ADR 0005).

### 1. Buckets (all private)
| Bucket | Purpose | Size limit | Allowed types (detected by magic bytes) | Default retention |
|---|---|---|---|---|
| `materials` | Course/session materials (CAT-06) | 200 MB | PDF, PPTX, DOCX, XLSX, MP4, MP3, PNG, JPEG, WebP, ZIP (only if allowed by tenant) | Life of material version; soft-deleted + 30 d |
| `images` | Logos, venue/person photos, question media | 10 MB | PNG, JPEG, WebP (**no SVG**, no GIF) | Life of owner |
| `evidence` | Qualifications, external certifications, task evidence, sign-in sheet scans, request attachments | 25 MB | PDF, PNG, JPEG, WebP | Training-record retention (≥ 10 y, DR-5) |
| `imports` | CSV/XLSX uploads for imports | 20 MB | CSV (text sniffing), XLSX | 30 d |
| `generated` | Certificate PDFs, sign-in sheets, report/data exports | — (server-written) | PDF, XLSX, CSV, JSON, ZIP | Certificates: record retention; exports: 24 h (FR-AUD-02) – 7 d |
| `quarantine` | Infected or rejected objects | — | any | 30 d, then purged |

Bucket `file_size_limit` and `allowed_mime_types` are configured as a first line of defense, but they rely on client-declared types; the authoritative check is the magic-byte check below.

### 2. Keys and metadata
- Key: `<tenant_id>/<module>/<entity_type>/<entity_id>/<file_id>` (ADR 0002 §8). The original filename is **never** part of the key; it is stored (sanitized, Unicode-normalized) in `platform.files.original_name` and returned via `Content-Disposition: attachment; filename*=UTF-8''…` (RFC 6266), so Arabic filenames work.
- `platform.files`: tenant_id, bucket, object_key, purpose, owner (module, entity type, entity id — no cross-schema FK), original_name, declared_mime, detected_mime, size_bytes, sha256, status (`pending_upload → uploaded → scanning → clean | infected | rejected | error`, plus `deleted`), scan engine + signature version, retention_class, legal_hold, created_by, timestamps. Business tables reference files by composite FK `(tenant_id, file_id)`.
- Objects are immutable: a new version of a material is a new file; `upsert` is disabled.

### 3. Upload flow
1. `files.requestUpload` (`defineAction`): checks the permission for the owning entity, validates declared type/size against the purpose allow-list and the tenant's storage quota, inserts `platform.files` (`pending_upload`, `upload_expires_at = now() + 15 min`), and creates a **signed upload URL** for the exact key with the user's own session (no service role in the request path).
2. The browser uploads directly to Storage (standard upload; resumable TUS upload for large materials — verify signed-URL support for TUS at implementation).
3. `files.completeUpload` marks the row `uploaded` and emits `com.entlaqa.platform.file.uploaded` (ADR 0004).
4. Worker job `platform.files.process` (service credentials, `**/jobs/**` only): verifies the object exists and its size; computes SHA-256; reads the first bytes and detects the real type (`file-type` library; CSV by strict text/encoding sniffing); rejects mismatches with the purpose allow-list; streams the object to `clamd` (`INSTREAM`); then:
   - clean → `clean`; images: `sharp` re-encodes, strips all metadata (EXIF incl. GPS) and writes variants (thumbnail, medium);
   - infected → object moved to `quarantine`, status `infected`, security event audited, uploader and tenant admin notified;
   - type mismatch/oversize → `rejected` (object deleted).
5. The UI shows "processing" until the file becomes `clean` (Realtime notification). **Nothing is downloadable or processed further (imports, certificates) before `clean`.**

### 4. Storage policies (`storage.objects`, defense in depth)
- `INSERT` for `authenticated`: bucket in the upload buckets **and** first folder = `private.current_tenant_id()` **and** `private.can_upload_object(bucket_id, name)` (a `platform.files` row for this key in `pending_upload`, created by `auth.uid()`, not expired).
- `SELECT` for `authenticated`: tenant prefix **and** `private.can_read_object(bucket_id, name)` = file is `clean`, not deleted, and a **short-lived download grant** exists (`platform.file_download_grants`: file_id, user_id, expires_at ≤ 5 min) created by the server action that authorized the download.
- No `UPDATE`/`DELETE` policies for `authenticated`. Deletion, quarantine moves and retention purges run in jobs through the Storage API (deleting rows in `storage.objects` alone does not remove backend objects).
- Helper functions live in `private`, `security definer`, `search_path = ''`, and are reviewed as security-relevant (ADR 0002 §6).

### 5. Downloads
- `files.getDownloadUrl` (`defineAction`) checks the permission on the owning entity (e.g., trainer-only materials, visibility windows in CAT-06), inserts a download grant, and returns a **signed URL** (TTL 60 s for documents, 5 min for media; `download` option forces `attachment` for everything except our own image variants and PDFs opened in the viewer).
- Files are served from the storage host (a different origin from the app), never from the app origin; SVG/HTML are never accepted, so there is no stored-XSS path. Verify `X-Content-Type-Options: nosniff` on storage responses; add at the gateway if missing.
- Every download of personal-data files (evidence, exports) is audited.

### 6. Generated files and certificates
- Certificate PDFs and sign-in sheets are rendered from HTML templates with Arabic shaping (headless Chromium, BRD H.1 — library choice in the M5 spike). The renderer is an SSRF/local-file/RCE-prone component (TM-0001 T-61, F-06) and is therefore **isolated**:
  - runs as a **separate process/container** (`pdf-renderer`) with **no credentials, no database or Storage access** and no egress except the asset allow-list; the worker job loads data, builds the HTML and receives the PDF bytes back, then stores them itself;
  - **JavaScript disabled**; request interception allows only allow-listed assets (bundled fonts, tenant logos/signatures passed inline as data URIs); `file://`, `data:` for non-images, and all other URLs are blocked;
  - templates are rendered with escaped variables before reaching the renderer (logic-less template engine, sanitized tenant rich text);
  - CPU, memory, page-count and wall-time limits per render; the container is non-root, read-only filesystem, restarted on failure.
- Output is stored in `generated/<tenant>/tms/certificate/<id>/<file_id>`, with `sha256` stored on the certificate row for tamper evidence (CRT-04). Re-issue creates a new file; the old one is retained.
- Exports are written to `generated`, linked from `platform.bulk_jobs`, downloadable for 24 h (FR-AUD-02), then purged.

### 7. Retention and quotas
Housekeeping job (ADR 0005): purge `pending_upload` rows/objects older than 24 h, expired exports, quarantine > 30 d, soft-deleted files after 30 d unless under legal hold or record retention. Per-tenant used bytes are tracked from `platform.files` for edition limits (SUB-01) and the admin home (ADM-14).

### 8. ClamAV operations
- `clamd` runs as a sidecar/service next to the worker (official `clamav/clamav` image). `StreamMaxLength`, `MaxFileSize` and `MaxScanSize` are raised above the 200 MB material limit (the defaults are far lower); archive limits (`MaxRecursion`, `MaxFiles`) guard against zip bombs (DOCX/PPTX/XLSX are ZIP containers).
- Signatures updated by `freshclam` via an approved egress path or a private mirror for in-country/air-gapped deployments; signature age is monitored (alert if > 24 h old).
- Scanner unavailable → files stay `scanning`, jobs retry; no fail-open.

## Consequences

**Positive:** direct uploads of large files; RLS-backed storage policies with no service key in request paths; uniform, audited scanning; the same model on Supabase cloud and self-hosted Storage.

**Negative / costs:** a container host is required for ClamAV in every deployment; download grants add one insert per authorized download; asynchronous "processing" state must be designed into the UX; large-file scanning adds latency (seconds to minutes).

## Security impact
Covers Plan §8.3 "File uploads": type/size checks (magic bytes), scanning with quarantine, private buckets, signed expiring URLs, no inline HTML/SVG, EXIF stripping (privacy), tenant-prefixed keys enforced by storage policies, audit of sensitive downloads. The isolated PDF renderer closes TM-0001 F-06/T-61; storage read policies requiring a download grant close F-13/T-34 (a Realtime token alone cannot read objects).

## Sovereign deployment impact
Self-hosted `storage-api` with an in-country S3-compatible backend (cloud object storage or a self-hosted S3 service; MinIO licensing/distribution changes must be checked at selection time), `imgproxy` not required (variants produced by `sharp`), ClamAV with a local signature mirror.

## Suite impact
`platform-files` is shared: other modules reuse buckets by purpose with their own `<module>` key segment and owner types.

## Verification
1. pgTAP tests of storage helper functions and policies: no upload without a pending row; no cross-tenant key; no read without a grant or before `clean`.
2. Integration tests: EICAR test file → `infected` + quarantine; renamed executable (`.pdf` extension) → `rejected`; JPEG with GPS EXIF → variant without metadata; 200 MB upload succeeds end-to-end on staging.
3. E2E: learner cannot obtain a URL for a trainer-only material (403/404); DAST probe of `/storage/v1/object/…` with a learner's Realtime token returns nothing (T-34).
4. Self-hosted smoke test includes an upload + scan cycle (ADR 0010).
5. Renderer tests (M5 spike): templates with SSTI, `<script>`, `file:///etc/passwd`, cloud-metadata and external URLs produce no script execution, no local file content and no outbound request; renderer container has no credentials in its environment.

## Implementation note T-M2-18 (9 Oct 2026)

Built as decided, with these refinements (runbook: `docs/engineering/files.md`):
- **Names.** The request-path API is `reserveUploadIntent` + `signUploadIntent`, `confirmUpload`, `getFileStatus`, `grantDownload` (for a file of the authorized owner entity) + `signDownload`, `deleteFile`, `markFileUsed` in `@jadarat/platform-files` (§3's `files.requestUpload` / `completeUpload` / `getDownloadUrl`; the owning module wraps them in its own `defineAction` after its permission check — the writing steps in the handler, the two `sign…` calls in `afterCommit`). Jobs read clean files with `createWorkerFiles({ store }).openScannedFile(tx, fileId)` (stream re-checked against the recorded size and SHA-256) and store generated files with `storeGeneratedFile`. The scan task is `platform.files.scan` (§3.4 named it `platform.files.process`), the retention job `platform.files.housekeeping`; both are platform tasks of the worker (ADR 0005 §4).
- **Committed reservation and grant.** Storage evaluates the policies of §4 on its own database connection and sees only committed rows, so the reservation and the download grant (with its audit row) are written in the action's transaction and Storage is asked for the signed URL only after it committed — in `defineAction`'s `afterCommit`, once, with no database connection held (integration review M1; the first design's separate transaction inside the action's could exhaust the pool or wait on its own locks). Signing refuses to run inside a transaction.
- **Storage's claim check.** The policies use `private.storage_request_tenant()` instead of `private.current_tenant_id()`: the same user-claim checks (live session, active membership, current organization — and, since the integration with T-M2-10, the same decision `private.session_access`: the organization's idle and maximum-length session rules and its MFA policy), accepted only when the session user is Storage's login role `supabase_storage_admin` (ADR 0002 §6a note). `current_tenant_id()` is unchanged.
- **Purposes.** Limits and accepted types are per purpose (`platform.file_purposes`, mirrored in TypeScript), not per bucket alone: `platform.user_import` (imports, 20 MB, CSV/XLSX), `platform.user_import_report` (generated), `platform.profile_photo` (images, 10 MB, PNG/JPEG/WebP). Profile photos use the `images` bucket of §1, not a separate one.
- **Retention.** Classes `import` (7 days after use, 24 hours if never used — PO, 9 Oct 2026), `export`, `owner_lifetime`, `record` (never purged by housekeeping). A purge removes the object, then the record — or keeps a nameless tombstone while a business row references it. Legal hold stops every purge.
- **Scanner limits.** `AlertExceedsMax` makes clamd report a file over its limits (including `MaxScanTime`, 90 s) as a finding instead of `OK`; such files are recorded as `rejected` (`unscannable`) and removed — never clean, not a malware event, but a low-severity audit event (`platform.file.unscannable`). Encrypted archives (findings starting exactly with `Heuristics.Encrypted.`) likewise: `rejected` (`encrypted`) with the same low-severity event (Tech Lead decision, 10 Oct 2026). Every other finding is `infected`.
- **Where checks run.** Size, type and hash are checked in the worker's single streaming pass together with the scan (§3.4), not at confirmation; confirmation only checks that the object exists and Storage's reported size.
- **Security review (10 Oct 2026), refinements of §3–§8** (runbook `files.md` §9):
  - **§4/§5 grant lifetime: at most 5 minutes**, as decided here (the first implementation allowed 10; the migration's checks now enforce 5 — 60 s documents, 300 s media). A grant is only for a file of exactly the **owner entity and purpose** the module authorized: `files.getDownloadUrl` is `grantDownload(tx, actor, { fileId, purpose, owner })` (then `signDownload` after the commit — integration review M1), checked by `private.grant_file_download`.
  - **§5 downloads are named by content:** the original name with the extension of the type the scan detected (`downloadName`); uploads must carry an extension of a type the purpose accepts.
  - **§3/§5 who creates signed URLs:** only the web app's server. Self-hosted, the gateway serves URL creation on an internal port for the app's network; browsers only use URLs. Hosted Supabase's sign endpoint accepts a user's own token and any lifetime: residual risk TM-0003 RR-FIL-01 (register R-58), bounded by the grant window.
  - **§7 orphan objects:** objects without a live file record (a rolled-back generated file, an object an upload URL created again after quarantine, removal or purge) are removed after 3 hours. Housekeeping locks and re-checks a file (legal hold, use) in the transaction that does its Storage work.
  - **§8 fail closed, fairly:** organizations take turns for scans; a file's own failures (also a stream clamd dropped while still answering a PING) end in `error` after 5; scanner unavailability is not counted against a file but ends in `error` 24 hours after its upload; signatures older than 7 days (or undated) stop all scanning, with an error logged (§8 "alert if > 24 h" stays as the warning).
  - **Staging** scanning stays opt-in (`FILE_SCANNING`), signatures refreshed daily from the Actions cache.
- **Not yet built:** image re-encoding and metadata stripping with `sharp` (with T-M2-15b, licence check pending), notifications on an infected file (a separate task; the `com.entlaqa.platform.file.scanned` event and audit events are in place), storage quotas (SUB-01), encrypted-document alerts (`AlertEncryptedDoc`, with the first PDF purpose), resumable uploads and the 200 MB staging test (with CAT-06).
- **Verification.** 1: pgTAP `80`–`84_files_*.sql` (also as Storage's role); 2: unit and integration tests (EICAR-like finding → infected + quarantine, renamed executable → rejected) and the self-hosted smoke with the real EICAR string built at run time (`infra/docker/smoke-files.sh`); 4: self-hosted smoke (CI gate 15).

## Implementation note T-M2-12 (10 Oct 2026) — the first consumer

- The bulk user import (`packages/platform-import`) uses the request-path API as decided, in its final shape (integration with T-M2-18's review, 10 Oct 2026): in the start action's transaction `reserveUploadIntent` (purpose `platform.user_import`, owner `platform/user_import/<import id>`) with the import itself, then `signUploadIntent` in the action's `afterCommit`; `confirmUpload` in the confirmation's transaction; the browser's `PUT` with progress straight to Storage (self-hosted: the CSP's `connect-src` allows exactly `STORAGE_PUBLIC_URL`'s origin, never a wildcard); for the importer's downloads of the list of problems and the error report (`platform.user_import_report`, written by the worker with `storeGeneratedFile` for the importer) `grantDownload` in the transaction and `signDownload` in `afterCommit`; every call through `fileResult` (expected refusals are answers); no import action declares `externalEffects`; `markFileUsed` when the run starts (the upload) and when the error report is written — so the `import` retention class counts 7 days from then.
- The worker reads only **clean** files (`openScannedFile`): an infected, rejected or failed upload ends the import as `rejected` with the file's reason; a deleted one as `FILE_DELETED`. Parsing never starts before the verdict (§3.4).
- The generated reports are XLSX of inline strings (security review L2): the purpose `platform.user_import_report` allows that type only (updated by the import's migration 20261016090000; the mirror in `purposes.ts`). A generated file is made only for an active member (`create_generated_file`), so the import makes no report for an importer who is gone.
- Runbook: `docs/engineering/user-import.md`; threat model TM-0003 T-IAM-19, 30, 46.

## Amendment (20 Oct 2026, PO decision) — branding images without a malware scan

**Decision (Product Owner, 20 Oct 2026, «B»):** the branding images (purposes `platform.brand_logo`, `platform.brand_favicon`, `platform.brand_sign_in_image`; WP-ADM-02, FR-ADM-07) are **no longer virus-scanned**, like Kawadir ATS (which keeps logos in a public bucket and shows them at once). Reason: the image must show as soon as the Organization Admin saves the Branding page; hosted production runs the worker (and the scanner) only every few hours, and not at all with `FILE_SCANNING` off, so scanned images were never published. **Every other purpose keeps the malware scan exactly as decided above.**

How it is built (runbooks `docs/engineering/branding.md` §2, `files.md` §1–§2; migrations `20261023100400`–`20261023100600`):
- **A purpose-level flag**, `platform.file_purposes.scan_required` (default `true`), `false` for the three branding purposes only. A check constraint allows `false` only for purposes users upload into `images` with raster image types (PNG, JPEG, WebP): no document, archive, spreadsheet or generated file can ever skip the scan. The scan task never leases an upload of such a purpose.
- **An honest status, `accepted`**: "checked by content and accepted without a malware scan, by the purpose's policy". `uploaded → accepted` only for purposes without a scan (write guard), with the detected type, size and SHA-256 of the bytes read; `accepted → deleted` only. Such a file is never `clean`, so nothing generic treats it as usable: no download grant, no Storage download, no module job (`openScannedFile`), no use mark — only the branding paths.
- **What still protects the images (§3 otherwise unchanged):** private bucket and tenant-prefixed key; size limits (logo 2 MB, favicon 500 KB, sign-in picture 5 MB) read with a cap; type **by content** (browser, server, and the database's signature check of the copy); at most 4096 px per side (favicon 512) from the header, no pixel decoded (no decompression bomb); **metadata removed** (EXIF/GPS, XMP, IPTC, comments, data after the end of the image — §3's re-encoding with `sharp` stays a follow-up); only the stripped **copy** is public, from PostgreSQL at `/api/brand/<id>` with the detected type, `nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`; audit of every change; replaced or removed images released.
- **Publishing at save time, without a Storage key in the web app:** Storage's read policy (§4) also admits the **uploader's own** upload of a purpose without a scan while it waits to be accepted (status `uploaded`, at most 24 hours after the upload) — no grant needed. The Save action reads it with the admin's own session **before** its transaction (`defineAction` `beforeTransaction`; no pooled connection held), prepares the copy, and publishes it **in** the save's transaction (`private.publish_brand_image`, owned by `file_guard`: an Organization Admin — `platform.tenant.manage` —, the caller's own upload of that purpose for that organization, the image the Branding uses for that kind, the size read equal to the stored object's, the copy no larger than the file and starting with its type's signature). The worker keeps a **fallback**: an image in use that the web app did not publish (Storage unavailable at the time, an older upload) is read with its key, prepared the same way and published with the same function.
- **Residual risk** (TM-0002 RR-TEN-08, accepted by the PO): a malicious but valid raster image could become an organization's public image; on hosted Supabase the uploader can, within the day their upload is readable, mint a signed link to their own bytes (as RR-FIL-01).
