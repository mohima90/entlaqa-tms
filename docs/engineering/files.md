# Files: storage, uploads, malware scanning (runbook)

> Backlog: **T-M2-18** · ADR 0006 (decision; implementation note at its end) · ADR 0002 §6a/§8 · NFR-SEC-08 · consumers: T-M2-12 (user import), T-M2-15b (profile photo)

Every file a person uploads is stored privately in Supabase Storage, scanned for malware and checked by content in the worker, and only then usable. Nothing in the web app holds a Storage key: Storage checks **our** policies with the signed-in user's own session.

| Piece | Where |
|---|---|
| Metadata, write guard, download grants, purposes | migration `20261015090000_platform__files.sql` (`platform.files`, `platform.file_download_grants`, `platform.file_purposes`, functions owned by the NOLOGIN role `file_guard`) |
| Buckets and `storage.objects` policies | migration `20261015090100_private__storage_buckets_and_policies.sql` |
| Request-path API for modules | `@jadarat/platform-files` (+ `@jadarat/platform-files/next` for the request context) |
| Worker side (scan, housekeeping, streams for jobs) | `@jadarat/platform-files/jobs` (jobs code and `apps/worker` only — dependency-cruiser) |
| Database helpers | `@jadarat/platform-db` (`files.ts`), `@jadarat/platform-db/jobs` (`jobs/files.ts`) |
| Storage clients | user's session: `@jadarat/platform-db/supabase-server` (`createUserFileStorage`); worker's key: `@jadarat/platform-db/admin` (`createStorageAdmin`) |
| Self-hosted Storage, clamd, freshclam, gateway paths | `infra/docker` (README "Files and malware scanning") |
| Tests | pgTAP `supabase/tests/80`–`84_files_*.sql`; unit tests next to the code; `platform-files/src/jobs/files.integration.test.ts`; `infra/docker/smoke-files.sh` |

## 1. Lifecycle

| Status | Meaning | Who moves it on |
|---|---|---|
| `pending_upload` | Reserved; the browser may upload to this one key for 15 minutes | the uploader confirms → `uploaded` (or `rejected`: empty / over the limit by Storage's size) |
| `uploaded` | Bytes in Storage, waiting for the scan (event `com.entlaqa.platform.file.uploaded`) | the worker leases it → `scanning` |
| `scanning` | Leased by a worker (15 minutes); stays here while the scanner or Storage is down | the worker → `clean`, `infected`, `rejected` or `error` |
| `clean` | Type, size and hash checked, no malware finding: the **only** usable status | the owner deletes → `deleted` |
| `infected` | Malware finding: object in the `quarantine` bucket, security audit event, never readable | housekeeping purges it after 30 days |
| `rejected` | Empty, too large, type not allowed by content, or over the scanner's limits (`unscannable`): object removed | housekeeping purges after 30 days |
| `error` | The file itself failed 5 scan attempts (`processing_failed`) or its object vanished (`object_missing`) | housekeeping purges after 30 days |
| `deleted` | Deleted by its owner (soft) | housekeeping purges per retention class |

The write guard (`files_transition` trigger) allows exactly these moves, by the right actor: users (app_server, their own file, via the `file_guard` functions) reserve, confirm and delete; only the worker (app_worker system claims) leases and records scans and housekeeping. Scan results, once written, never change. Event `com.entlaqa.platform.file.scanned` (data: `purpose`, `outcome`, `reason`) tells the owning module.

## 2. Purposes

A module never picks a bucket or a type list itself: it names a **purpose**. The database (`platform.file_purposes`) is the authority; `FILE_PURPOSES` in `platform-files/src/purposes.ts` mirrors it (an integration test keeps both equal). A module adds a purpose in **both** places, in its own migration.

| Purpose | Bucket | Max | Types (by content) | Retention class | Written by | Downloads |
|---|---|---|---|---|---|---|
| `platform.user_import` | `imports` | 20 MB | CSV (strict UTF-8), XLSX (not XLSM) | `import` | user (scanned) | audited, 60 s |
| `platform.user_import_report` | `generated` | 50 MB | CSV | `import` | worker (clean) | audited, 60 s |
| `platform.profile_photo` | `images` | 10 MB | PNG, JPEG, WebP (never SVG/GIF) | `owner_lifetime` | user (scanned) | 300 s |

Buckets (ADR 0006 §1, all private): `materials` 200 MB, `images` 10 MB, `evidence` 25 MB, `imports` 20 MB, `generated`, `quarantine`. Object keys: `<tenant_id>/<module>/<entity_type>/<entity_id>/<file_id>` — the original name is **never** in the key; it is kept sanitized (NFC, no controls or bidirectional overrides, no path characters) for display and the download's `Content-Disposition` (Arabic names work).

## 3. Request path (modules)

The owning **module authorizes first** (may this user attach a file to / read a file of this entity?), then calls the files service. Example for an import screen (T-M2-12):

```ts
import { createUploadIntent, confirmUpload, getFileStatus, createDownloadGrant } from '@jadarat/platform-files';
import { fileRequestContext } from '@jadarat/platform-files/next';

// 1. Server action "start upload" — after checking the user may import:
const intent = await createUploadIntent(await fileRequestContext(claims), {
  purpose: 'platform.user_import',
  owner: { module: 'platform', entityType: 'user_import', entityId: importId },
  declaredName: file.name, declaredType: file.type, size: file.size,
});
// → { fileId, url, method: 'PUT', contentType, maxBytes, expiresAt }
// 2. The browser PUTs the bytes to `url` with Content-Type `contentType` (no session needed).
// 3. Server action "upload done":
const view = await withUserTx(claims, (tx) => confirmUpload(tx, intent.fileId)); // status 'uploaded'
// 4. The UI polls getFileStatus (or listens for file.scanned) until a FINAL_STATUSES value.
// 5. Download, after the module's own check:
const link = await createDownloadGrant(await fileRequestContext(claims), actorFromClaims(claims), fileId);
```

| Function | What it does | Refusals (DomainError codes) |
|---|---|---|
| `createUploadIntent(context, input)` | Validates purpose, owner, size and declared type (from the extension first), sanitizes the name, **reserves the upload in its own committed transaction**, then asks Storage — with the user's session — for a signed upload URL for exactly that key | `UNKNOWN_PURPOSE`, `INVALID_FILE_DATA`, `TOO_LARGE`, `TYPE_NOT_ALLOWED`, `TOO_MANY_PENDING_UPLOADS` (50 unconfirmed uploads per user in 24 hours), `STORAGE_REFUSED`, `STORAGE_UNAVAILABLE` |
| `confirmUpload(tx, fileId)` | The uploader confirms after the PUT; checks the object exists; `uploaded` (queued) or `rejected` | `FILE_NOT_FOUND`, `OBJECT_NOT_UPLOADED`, `UPLOAD_EXPIRED` (reservation older than 24 h) |
| `getFileStatus(tx, fileId)` | Status view (name, types, size, hash, reason) for its uploader or a job of its tenant; `null` otherwise | — |
| `createDownloadGrant(context, actor, fileId)` | **Clean files only.** Writes a download grant (and, for audited purposes, the audit event `platform.file.download_granted`) in its own committed transaction, then asks Storage for a signed URL of the purpose's lifetime that downloads as an attachment with the original name | `FILE_NOT_FOUND`, `FILE_NOT_CLEAN`, `STORAGE_REFUSED`, `STORAGE_UNAVAILABLE` |
| `deleteFile(tx, fileId)` | Soft delete by its uploader; the object goes with housekeeping | `FILE_NOT_FOUND`, `FILE_BUSY` (scanning, or infected) |
| `markFileUsed(tx, fileId)` | Records the first use of a clean file (imports: kept 7 days from then) | `FILE_NOT_FOUND`, `FILE_NOT_CLEAN` |

**Why the two transactions.** Storage evaluates our policies on its **own** database connection, so it sees only committed rows. The reservation (for the signed upload URL) and the download grant (for the signed download URL) are therefore committed before Storage is asked — `context.ownTx` runs a transaction of the signed-in user for exactly that (`fileRequestContext` builds it with `withUserTx`). A reservation whose URL is never used expires (15 minutes) and is purged after 24 hours; a grant expires with its URL (60 s / 300 s).

**What Storage checks** (policies on `storage.objects`, with the user's JWT): the key's first folder is the user's tenant (`private.storage_request_tenant()`: the same claim checks as `private.current_tenant_id()` — live session, active membership, current organization — for Storage's login role `supabase_storage_admin` only); **upload** only to the key of the user's own `pending_upload` reservation, not expired; **read** only a clean, not deleted file with an unexpired grant for this user. No update or delete for users at all; no listing.

**Business tables** reference files by composite foreign key `(tenant_id, file_id) references platform.files (tenant_id, id)`. With the default `no action`, a purge keeps a **tombstone** (name replaced by `deleted`, object removed) while the row references it; with `on delete set null (file_id)` the reference simply disappears. Choose per table; never `cascade` (a purge must not delete business rows).

## 4. Worker side (jobs)

Module jobs use `createWorkerFiles({ store })` from `@jadarat/platform-files/jobs`, bound by `apps/worker` to Storage with the worker's key (`createStorageAdmin`):

- `openScannedFile(tx, fileId): Promise<ReadableStream<Uint8Array>>` — the bytes of a **clean** file of the job's tenant (`tx` from `withSystemTx`); refuses anything else (`FILE_NOT_CLEAN`, also while scanning). The stream re-checks the size and SHA-256 recorded by the scan and fails with `FileIntegrityError` at its end if they differ — treat everything read as void then.
- `storeGeneratedFile(tx, file)` — stores bytes a job produced (e.g. the import's error report) as a clean file for a user; returns its id.
- Status, use and deletion inside a job: `getFileStatus`, `markFileUsed`, `deleteFileRecord` from `@jadarat/platform-db` with the job's transaction.

Platform tasks (ADR 0005 §4; every wake-up and every minute):

| Task | Runs when | Does |
|---|---|---|
| `platform.files.scan` | Storage (`SUPABASE_URL` + `SUPABASE_SECRET_KEY`) **and** the scanner (`CLAMD_HOST`, `CLAMD_PORT` default 3310) are configured | Leases up to 5 files per pass, oldest first. Reads each object **once** as a stream: counts it (over the purpose's limit → `rejected`, `too_large`), hashes it, keeps its first 1 MiB for type detection (`file-type` magic bytes; strict UTF-8 CSV sniffing) and sends every byte to clamd (`INSTREAM`). Outcome in the file's tenant transaction: any finding → `infected` (quarantine move, audit event `platform.file.infected`, log line `security: file <id> … is infected`); clamd's limit findings → `rejected` (`unscannable`); type not allowed by content (e.g. a renamed executable, a macro workbook) → `rejected`; else `clean`. |
| `platform.files.housekeeping` | Storage is configured | Removes expired download grants; moves infected objects still in their upload bucket to `quarantine`; removes rejected objects; purges files past their retention (object first, then the record or a tombstone). Never a file on **legal hold**. |

**Fail closed.** Scanner or Storage unreachable → the file stays `scanning` and is tried again (15 s, 30 s, … at most every 15 minutes, for as long as it takes); the pass stops. A failure of the file itself → retried, `error` after 5 attempts. Nothing ever becomes `clean` without a verdict. Without `CLAMD_HOST` the worker logs `file scanning: off` at start-up and uploads wait.

**Signatures.** The scan task warns hourly when clamd's signatures are older than 24 hours. Operators check the scanner with `node main.mjs scanner-check` (exit code 2 when stale; self-hosted: `docker compose run --rm --no-deps worker main.mjs scanner-check`).

## 5. Retention (housekeeping rules)

| Class | Purged | PO decision |
|---|---|---|
| `import` | 7 days after first use (`markFileUsed` — T-M2-12 calls it when the import is confirmed and runs); 24 hours after upload if never used; at once once deleted | 9 Oct 2026 |
| `export` | 24 hours after creation, or once deleted | ADR 0006 §6 (FR-AUD-02) |
| `owner_lifetime` | 30 days after its owner deleted it | ADR 0006 §1 |
| `record` | never by this job (training-record retention ≥ 10 years, DR-5; its own rules come with the records) | — |
| any | `pending_upload` after 24 h; `rejected`/`error` after 30 days; `infected` 30 days after the scan | ADR 0006 §7 |

`legal_hold = true` stops every purge of that file (set by the platform administrator's tooling, later).

## 6. Security notes

- **No service key on the request path.** The web app talks to Storage with the user's session only; the Storage/Auth secret key exists in the worker only (ADR 0002 §7 implementation notes T-M2-17, T-M2-18). dependency-cruiser keeps `@jadarat/platform-files/jobs` and `@jadarat/platform-db/admin` out of `apps/suite`.
- **Logs** carry file ids, purposes, outcomes and codes — never names, contents or URLs (signed URLs carry tokens; download URLs carry the name). Self-hosted Storage logs errors only for that reason.
- **Downloads** are always attachments with `X-Content-Type-Options: nosniff`; self-hosted, the gateway adds `Content-Security-Policy: default-src 'none'; sandbox`. SVG, HTML and macro-enabled Office files are refused by content.
- **Names** are sanitized in TypeScript and checked again by the database (`files_name_check`).
- Residual risks, accepted for now: hosted Supabase signs upload URLs for 2 hours (not configurable; our reservation window is 15 minutes, and an upload after it is never confirmed and is purged); hosted Storage's request logs (Supabase's, not ours) contain the download name of each signed download URL.

## 7. Deployments

**Self-hosted:** `infra/docker` runs Storage (file backend here, S3-compatible in production), clamd and freshclam; see its README ("Files and malware scanning") for the object backend, the public origin (`STORAGE_PUBLIC_URL`), signature mirror and upgrade steps.

**Hosted Supabase (staging), after the merge — Product Owner:**
1. **Actions → DB deploy** → `plan`, then `apply`. Creates the file tables, the six private buckets and the three `storage.objects` policies (the migration role can create them on hosted Supabase; simulated in CI by `pnpm db:test:hosted-sim`).
2. **Check Storage's database role** (Supabase → SQL editor): `select distinct usename from pg_stat_activity where usename like 'supabase_storage%';` → expected `supabase_storage_admin`. Our storage policies accept user claims only for that role; another name means every upload is refused (fail closed) — report it.
3. **Nothing new in Vercel**: the web app needs no Storage key; `STORAGE_PUBLIC_URL` stays unset on hosted Supabase (the project URL is already public and in the CSP's `connect-src`).
4. **Worker** (GitHub environment `staging-jobs`): `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (already needed for password-reset links, T-M2-17) give the worker Storage: housekeeping runs. **File scanning** needs the variable `FILE_SCANNING` = `on`: each 5-minute pass then starts clamd on the runner (about 1–2 more minutes per run). The run logs are public (public repository): the scan logs file ids, purposes, outcomes and scanner findings only.
5. Storage's global upload limit on the Free plan is 50 MB: enough for imports (20 MB) and photos (10 MB); the 200 MB `materials` bucket (CAT-06, later) needs a paid plan.

**Staging limitation.** Staging has no container host: uploads are scanned only when the scheduled **Jobs (staging)** pass runs (every 5 minutes, often later), and only with `FILE_SCANNING=on`. Until then they stay `uploaded` — never clean, never usable. A continuous worker host (clamd running all the time, scans within seconds) is the PO's pending cost decision.

## 8. Follow-ups (not in T-M2-18)

- **T-M2-12**: the upload screen — browser `PUT` with progress, polling `getFileStatus`, calling `markFileUsed` when the import runs; self-hosted: add `STORAGE_PUBLIC_URL`'s origin to the CSP `connect-src`.
- **T-M2-15b**: profile photos — ADR 0006 §3 also asks to re-encode images and strip metadata (EXIF/GPS) with `sharp` before use; not built yet (needs the PO's acceptance of `sharp`/libvips licensing, LGPL-3.0).
- Notifying the uploader and the organization's admin of an infected file (ADR 0006 §3.4): the `file.scanned` event is there; the notification comes with the first upload screen.
- Tenant storage quota (SUB-01), resumable (TUS) uploads for large materials, 200 MB end-to-end on staging (ADR 0006 Verification 2): with CAT-06.
