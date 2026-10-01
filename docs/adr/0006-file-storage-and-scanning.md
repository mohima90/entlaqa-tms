# ADR 0006 — File storage, signed URLs and malware scanning

**Status:** Accepted — PR #9, 30 Sep 2026 · **Date:** 30 Sep 2026 · **Backlog:** T-M1-B06 · **Related:** BRD §3.4.1 (files service), FR-CAT-06, FR-ADM-07, FR-IAM-04, FR-INS-02, FR-CRT-01…06, FR-ATT-11, FR-LOG-01, FR-AUD-02/03, FR-SUB-01, NFR-SEC-08, DR-5, DR-6; Development Plan §8.3 (file uploads); TM-0001 F-06, F-13 (T-34, T-61); ADR 0001, ADR 0002 §8, ADR 0003 §4.4, ADR 0004, ADR 0005, ADR 0010

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
