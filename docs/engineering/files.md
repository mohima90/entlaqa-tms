# Files: storage, uploads, malware scanning (runbook)

> Backlog: **T-M2-18** · ADR 0006 (decision; implementation note at its end) · ADR 0002 §6a/§8 · NFR-SEC-08 · consumers: T-M2-12 (user import), T-M2-15b (profile photo)

Every file a person uploads is stored privately in Supabase Storage, scanned for malware and checked by content in the worker, and only then usable — except the purposes that need no malware scan (`scan_required = false`: the branding images only, PO decision 20 Oct 2026, §2). Nothing in the web app holds a Storage key: Storage checks **our** policies with the signed-in user's own session.

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
| `pending_upload` | Reserved; the browser may upload to this one key for 15 minutes | the uploader confirms → `uploaded` (or `rejected`: empty, over the limit by Storage's size, or stored with another Content-Type than the declared one — `type_mismatch`) |
| `uploaded` | Bytes in Storage, waiting for the scan (event `com.entlaqa.platform.file.uploaded`) | the worker leases it → `scanning` |
| `scanning` | Leased by a worker (15 minutes); stays here while the scanner or Storage is down (at most 24 hours after the upload) | the worker → `clean`, `infected`, `rejected` or `error`; the owner may delete it while no worker holds its lease |
| `clean` | Type, size and hash checked, no malware finding: the **only** usable status (for every generic path: downloads, module jobs, use marks) | the owner deletes → `deleted` |
| `accepted` | A purpose **without a malware scan** (`scan_required = false`, the branding images; PO, 20 Oct 2026): checked by content, size and pixels and published by its module, which recorded the detected type, size and SHA-256 of the bytes it read — **never scanned, never `clean`**: no download grant, no module job reads it; only its module's own path (branding: the published copy) uses it; housekeeping removes its Storage object once the copy is published (§5) | the owner deletes (a replaced or removed image is released) → `deleted` |
| `infected` | Malware finding: object in the `quarantine` bucket, security audit event, never readable | housekeeping purges it after 30 days |
| `rejected` | Empty, too large, type not allowed by content or not the declared one, an encrypted archive (`encrypted`), or over the scanner's limits (`unscannable`): object removed | the owner deletes; housekeeping purges after 30 days |
| `error` | The file itself failed 5 times although the scanner answered (`processing_failed`), it crashed the scanner 3 times (`scanner_crashed`, a high-severity security event), it had no verdict 24 hours after its upload because the scanner or Storage was unavailable (`scanner_unavailable`, logged as an error), or its object vanished (`object_missing`) | the owner deletes; housekeeping purges after 30 days |
| `deleted` | Deleted by its owner (soft) | housekeeping purges per retention class |

The write guard (`files_transition` trigger) allows exactly these moves, by the right actor (`uploaded → accepted` only for a purpose without a scan, migration 20261023100500): users (app_server, their own file, via the `file_guard` functions) reserve, confirm and delete; only the worker (app_worker system claims) leases and records scans and housekeeping. Scan results, once written, never change. Event `com.entlaqa.platform.file.scanned` (data: `purpose`, `outcome`, `reason`) tells the owning module. Only purposes users upload can be uploaded or confirmed by a user: a worker-generated file reserved for a user (its report) is the worker's to write.

## 2. Purposes

**Purposes without a malware scan** (`platform.file_purposes.scan_required = false`, migration 20261023100400; PO decision 20 Oct 2026, ADR 0006 amendment): only the three branding images. A check constraint allows it only for purposes users upload into `images` with raster image types (PNG, JPEG, WebP) — no document, archive, spreadsheet or generated file can ever skip the scan. Their uploads are never leased by the scan task; the owning module reads them back (the uploader's own session: Storage's read policy below), checks them by content, size and pixels, strips their metadata and publishes what it made of them, and the file becomes `accepted`. A module adding such a purpose needs a PO decision and its own threat-model entry.

A module never picks a bucket or a type list itself: it names a **purpose**. The database (`platform.file_purposes`) is the authority; `FILE_PURPOSES` in `platform-files/src/purposes.ts` mirrors it (an integration test keeps both equal). A module adds a purpose in **both** places, in its own migration.

| Purpose | Bucket | Max | Types (by content) | Retention class | Written by | Downloads |
|---|---|---|---|---|---|---|
| `platform.user_import` | `imports` | 20 MB | CSV (strict UTF-8), XLSX (not XLSM) | `import` | user (scanned) | audited, 60 s |
| `platform.user_import_report` | `generated` | 50 MB | XLSX (T-M2-12: inline strings only, no formula ever runs) | `import` | worker (clean) | audited, 60 s |
| `platform.profile_photo` (WP-ADM-04) | `images` | 2 MB | PNG, JPEG, WebP (never SVG/GIF) | `owner_lifetime` | user (**not scanned**, PO 21 Oct 2026 → `accepted`; the person's own photo only) | none (a copy in `platform.person_photos` is served at `/api/photo/<person>` only to members who can see that person: `private.actor_sees_person`) |
| `platform.brand_logo` / `platform.brand_favicon` / `platform.brand_sign_in_image` (WP-ADM-02) | `images` | 2 MB / 500 KB / 5 MB | PNG, JPEG, WebP (never SVG/GIF) | `owner_lifetime` | user (**not scanned**, PO 20 Oct 2026 → `accepted`) | none (never `clean`); public copies of the images in use, published when saved: `docs/engineering/branding.md` |

Buckets (ADR 0006 §1, all private): `materials` 200 MB, `images` 10 MB, `evidence` 25 MB, `imports` 20 MB, `generated`, `quarantine`. Object keys: `<tenant_id>/<module>/<entity_type>/<entity_id>/<file_id>` — the original name is **never** in the key; it is kept sanitized (NFC, no controls or bidirectional overrides, no path characters) for display and the download's `Content-Disposition` (Arabic names work).

**Names and types.** An upload's name must end in an extension that names a type the purpose accepts (`.csv`, `.xlsx`, `.png`, `.jpg`/`.jpeg`, `.webp`; `declaredTypeFor`): no extension, or an unknown one (`.hta`, `.js`, `.bat`, `.exe`, `.html`, `.svg` …), is refused before anything is stored. That type is recorded, sent by the browser as the upload's `Content-Type` and checked against what Storage stored at confirmation. The browser's own type is never used. A **download** is saved under the original name with the extension of the type the scan **detected by content** (`downloadName`: `staff.csv` that is really a workbook downloads as `staff.xlsx`; a name the uploader could still choose — a generated file's, an older record's — never decides the extension). Download links live at most **5 minutes** (60 s for documents, 300 s for media; enforced by `file_purposes_ttl_check` and `file_download_grants_ttl_check`).

## 3. Request path (modules)

The owning **module authorizes first** (may this user attach a file to / read files of this entity?), then calls the files service from its own `defineAction`. Every step that writes runs in the **action's transaction** (the handler); Storage signs **after the commit**, in the action's `afterCommit` (no database connection held). Example for an import screen (T-M2-12):

```ts
import {
  confirmUpload, fileResult, grantDownload, reserveUploadIntent, signDownload, signUploadIntent,
} from '@jadarat/platform-files';
import { requestFileStorage } from '@jadarat/platform-files/next';

// 1. Server action "start upload" — after checking, in the handler, that the user may import:
export const startUpload = defineAction({
  permission, input, // …
  handler: ({ ctx, input }) =>
    fileResult(reserveUploadIntent(ctx.tx, {
      purpose: 'platform.user_import',
      owner: { module: 'platform', entityType: 'user_import', entityId: input.importId },
      declaredName: input.name, // its extension decides the declared type (.csv / .xlsx here)
      size: input.size,
    })),
  // Committed: Storage now sees the reservation.
  afterCommit: async ({ result }) => fileResult(signUploadIntent(await requestFileStorage(), result)),
});
// → { fileId, url, method: 'PUT', contentType, maxBytes, expiresAt }
// 2. The browser PUTs the bytes to `url` with Content-Type `contentType` (no session needed).
// 3. Server action "upload done" (handler only): confirmUpload(ctx.tx, fileId) → status 'uploaded'.
// 4. The UI polls getFileStatus (or listens for file.scanned) until a FINAL_STATUSES value.
// 5. Download, after the module's own check (handler) that this user may read files of `owner`:
export const downloadImportFile = defineAction({
  permission, input, // …
  handler: ({ ctx, input }) =>
    fileResult(grantDownload(ctx.tx, ctx.actor, {
      fileId: input.fileId,
      purpose: 'platform.user_import',
      owner, // the entity the module authorized: a file of any other entity is FILE_NOT_FOUND
    })),
  afterCommit: async ({ result }) => fileResult(signDownload(await requestFileStorage(), result)),
});
// → { url, expiresAt, name } — `name`: the original name with the extension of the detected type
```

| Function | Where | What it does | Refusals (DomainError codes) |
|---|---|---|---|
| `reserveUploadIntent(tx, { purpose, owner, declaredName, size })` | handler (action's transaction) | Validates purpose, owner and size; sanitizes the name, whose **extension must name a type the purpose accepts** (`declaredTypeFor`); reserves the upload (pending, 15 minutes) for one object key | `UNKNOWN_PURPOSE`, `INVALID_FILE_DATA`, `TOO_LARGE`, `TYPE_NOT_ALLOWED` (no or unknown extension, or one the purpose does not accept), `TOO_MANY_PENDING_UPLOADS` (50 unconfirmed uploads per user in 24 hours) |
| `signUploadIntent(storage, reservation)` | `afterCommit` | Asks Storage — with the user's session — for a signed upload URL for exactly that key | `STORAGE_REFUSED`, `STORAGE_UNAVAILABLE` |
| `confirmUpload(tx, fileId)` | handler | The uploader confirms after the PUT; checks the object exists; `uploaded` (queued) or `rejected` (empty, too large, stored with another Content-Type) | `FILE_NOT_FOUND`, `OBJECT_NOT_UPLOADED`, `UPLOAD_EXPIRED` (reservation older than 24 h) |
| `getFileStatus(tx, fileId)` | handler / query | Status view (name, types, size, hash, reason) for its uploader or a job of its tenant; `null` otherwise | — |
| `grantDownload(tx, actor, { fileId, purpose, owner })` | handler | **Clean files of exactly that owner entity and purpose only** (checked by the database: `private.grant_file_download`). Writes the download grant and, for audited purposes, the audit event `platform.file.download_granted`; returns the saved name `downloadName(original, detected type)` | `FILE_NOT_FOUND` (also: another owner entity, module or purpose), `FILE_NOT_CLEAN` |
| `signDownload(storage, granted)` | `afterCommit` | Asks Storage for a signed URL of the purpose's lifetime that downloads as an attachment under that name | `STORAGE_REFUSED`, `STORAGE_UNAVAILABLE` |
| `deleteFile(tx, fileId)` | handler | Soft delete by its uploader — also a file still waiting for the scanner, or failed; the object goes with housekeeping | `FILE_NOT_FOUND`, `FILE_BUSY` (a worker is scanning it right now — try again shortly —, or infected) |
| `markFileUsed(tx, fileId)` | handler | Records the first use of a clean file (imports: kept 7 days from then) | `FILE_NOT_FOUND`, `FILE_NOT_CLEAN` |

**Why the transaction step and `afterCommit` (integration review M1).** Storage evaluates our policies on its **own** database connection, so it sees only committed rows: the reservation and the grant must be committed before Storage is asked. They are written in the **action's own transaction** — one pooled connection per request, retried as a whole by `defineAction` after a deadlock or serialization failure (T-M2-10), the audit row with them — and signed in `afterCommit`, which runs **once**, after the commit, with **no connection held**. So file actions need no `externalEffects`, and there is no second transaction inside the first: an earlier design (`ownTx`) opened one, which could exhaust the pool (`max: 5`, no queue timeout: five concurrent uploads each holding a connection and waiting for a sixth) and wait on row locks of its own outer transaction (a self-deadlock PostgreSQL cannot detect). `signUploadIntent` / `signDownload` (and the user Storage client itself) **refuse to run inside a transaction** of the request (`assertNoDatabaseTransaction`, marked by platform-db's transaction helpers), so the wrong shape fails at once instead of hanging. If signing fails after the commit, what stays is harmless: a reservation expires unused (15 minutes) and is purged after 24 hours; a grant expires with its URL (60 s / 300 s). `requestFileStorage()` (`@jadarat/platform-files/next`) is the user's Storage client for `afterCommit`.

**Refusals are answers, not internal errors (integration review L-b).** The functions throw `DomainError`s; wrap each call in `fileResult(…)` so the expected ones become error results with the codes of `FileErrors` (Arabic and English messages under `files.errors.*`): `TYPE_NOT_ALLOWED` → `FILE_TYPE_NOT_ALLOWED` (422), `TOO_LARGE` → `FILE_TOO_LARGE` (422), `TOO_MANY_PENDING_UPLOADS` → `FILE_TOO_MANY_UPLOADS` (429), `FILE_NOT_CLEAN` → `FILE_NOT_READY`, `OBJECT_NOT_UPLOADED` → `FILE_NOT_UPLOADED`, `UPLOAD_EXPIRED` → `FILE_UPLOAD_EXPIRED`, `FILE_BUSY` (409), `FILE_NOT_FOUND` → `NOT_FOUND`, `STORAGE_REFUSED` → `FORBIDDEN`, `STORAGE_UNAVAILABLE` → `FILE_STORAGE_UNAVAILABLE` (503). In the handler an error result rolls the transaction back; in `afterCommit` it is the answer and `defineAction` logs a **warning** with the permission and the code (`action refused after its commit`) — no error-tracker event. `UNKNOWN_PURPOSE` and `INVALID_FILE_DATA` (a module passing a purpose or owner it must never pass), the transaction guard and any other error stay thrown: an internal error with a correlation id, reported.

**Who creates signed URLs.** Only the web app's server, with the user's session. Self-hosted, it asks Storage on the gateway's **internal port 8445** (`STORAGE_INTERNAL_URL`; the app's network `edge` alone); the browser-facing port 8443 serves only the uploads (`PUT`, with its CORS preflight) and downloads (`GET`) with a URL's token — a user's own token cannot create a URL there, of any lifetime (security review M2, smoke-tested). On hosted Supabase the project URL serves both: see the residual risk in §6.

**What Storage checks** (policies on `storage.objects`, with the user's JWT): the key's first folder is the user's tenant (`private.storage_request_tenant()`: the same claim checks as `private.current_tenant_id()`, through the same decision `private.session_access` — live session, not ended, within the organization's idle and maximum-length rules, active membership, current organization, the organization's MFA policy (T-M2-10) — for Storage's login role `supabase_storage_admin` only); **upload** only to the key of the user's own `pending_upload` reservation of an uploaded purpose, not expired; **read** only a clean, not deleted file with an unexpired grant for this user — or the user's **own** upload of a purpose without a malware scan while it waits to be accepted (`uploaded`, at most 24 hours after the upload; the branding images are read back this way at save time, `GET /storage/v1/object/images/<key>`, self-hosted on the internal port 8445 too). No update or delete for users at all (so no upsert over uploaded or scanned bytes); no listing.

**Business tables** reference files by composite foreign key `(tenant_id, file_id) references platform.files (tenant_id, id)`. With the default `no action`, a purge keeps a **tombstone** (name replaced by `deleted`, object removed) while the row references it; with `on delete set null (file_id)` the reference simply disappears. Choose per table; never `cascade` (a purge must not delete business rows).

## 4. Worker side (jobs)

Module jobs use `createWorkerFiles({ store })` from `@jadarat/platform-files/jobs`, bound by `apps/worker` to Storage with the worker's key (`createStorageAdmin`):

- `openScannedFile(tx, fileId): Promise<ReadableStream<Uint8Array>>` — the bytes of a **clean** file of the job's tenant (`tx` from `withSystemTx`); refuses anything else (`FILE_NOT_CLEAN`, also while scanning). The stream re-checks the size and SHA-256 recorded by the scan and fails with `FileIntegrityError` at its end if they differ — treat everything read as void then.
- `storeGeneratedFile(tx, file)` — stores bytes a job produced (e.g. the import's error report) as a clean file for a user; returns its id. The bytes are written to Storage before the job's transaction commits: if it rolls back, the object is an orphan and housekeeping removes it after 3 hours.
- Status, use and deletion inside a job: `getFileStatus`, `markFileUsed`, `deleteFileRecord` from `@jadarat/platform-db` with the job's transaction.

Platform tasks (ADR 0005 §4; every wake-up and every minute):

| Task | Runs when | Does |
|---|---|---|
| `platform.files.scan` | Storage (`SUPABASE_URL` + `SUPABASE_SECRET_KEY`) **and** the scanner (`CLAMD_HOST`, `CLAMD_PORT` default 3310) are configured | Leases up to 5 files per pass (never an upload of a purpose without a scan); **organizations take turns** (the one whose last turn is longest ago first, then its oldest file), so one organization's uploads — or a file that keeps failing — never hold up the others. Reads each object **once** as a stream: counts it (over the purpose's limit → `rejected`, `too_large`), hashes it, keeps its first 1 MiB for type detection (`file-type` magic bytes; strict UTF-8 CSV sniffing) and sends every byte to clamd (`INSTREAM`). Outcome in the file's tenant transaction: a malware finding → `infected` (quarantine move, audit event `platform.file.infected` with `severity: high`, log line `security: file <id> … is infected`); an encrypted archive (finding `Heuristics.Encrypted.*`) → `rejected` (`encrypted`) and clamd's limit findings (`Heuristics.Limits.Exceeded.*`: archive depth, file count, size, scan time) → `rejected` (`unscannable`), both with the audit event `platform.file.unscannable` (`severity: low`) — not malware, but nothing was checked inside; type not allowed by content (e.g. a renamed executable, a macro workbook) → `rejected`; else `clean`. |
| `platform.files.housekeeping` | Storage is configured | Removes expired download grants; moves infected objects still in their upload bucket to `quarantine`; removes rejected objects; purges files past their retention (object first, then the record or a tombstone). Each file's Storage work runs in one transaction that first **locks the file and re-checks** that the action is still due (`lock_file_housekeeping`): a legal hold set, a use recorded or a scan lease taken since the lease stops it. At most hourly, **orphan objects** are removed too (below). Never a file on **legal hold**. |

**Fail closed.** Nothing ever becomes `clean` without a verdict:
- **Scanner or Storage unavailable** (clamd unreachable, Storage down or its stream broken off) → the file stays `scanning` and is tried again (15 s, 30 s, … at most every 15 minutes); the pass stops. These waits are not counted against the file; but a file still without a verdict **24 hours after its upload** becomes `error` (`scanner_unavailable`) and the worker logs an **error** (alert on it).
- **clamd drops a file's stream** (connection lost while streaming or waiting for the verdict): the worker sends clamd a `PING` at once; if clamd answers, the file is at fault — a failure of the file itself. If clamd does **not** answer, it probably crashed on the file (and restarts): the file waits like an outage, but the suspected crash is counted for it (`scan_crashes`, an error log); at the **third**, the file is `error` (`scanner_crashed`) and the worker writes the security event `platform.file.scanner_crashed` (`severity: high`) — a file that kills the scanner cannot take it down for every organization again and again.
- **A failure of the file itself** (that, or clamd answering `ERROR` for it) → retried, `error` (`processing_failed`) after 5 such failures.
- clamd scans a file for at most 90 s (`MaxScanTime` in `clamd.conf`; past it: `Heuristics.Limits.Exceeded.MaxScanTime`, i.e. `unscannable`); the worker waits up to 150 s for a verdict (`CLAMD_VERDICT_TIMEOUT_MS` — keep it longer than `MaxScanTime`). clamd's scratch space (`/tmp`, memory) is bounded (2 GB self-hosted and on staging).
- Without `CLAMD_HOST` the worker logs `file scanning: off` at start-up and uploads wait.

**Signatures.** The scan task warns hourly when clamd's signatures are older than 24 hours. Older than the **hard limit** — 7 days, `FILE_SCAN_SIGNATURES_MAX_AGE_DAYS` — or of an unknown date, it **scans nothing** (uploads wait, never clean) and logs an error hourly (`malware signatures are … NOTHING is scanned`). Only test installations whose clamd keeps pinned signatures raise the limit, and the worker accepts a value above 7 only with `FILE_SCAN_SIGNATURES_TEST_OVERRIDE=1` and never with a production-like `JADARAT_ENVIRONMENT` (`prod`, `prd`, `live`): the smoke test sets both (365 days); the worker warns at start-up whenever the limit is above 7. Operators check the scanner with `node main.mjs scanner-check`: exit code 2 when stale (> 24 h; still scanning), 3 when over the hard limit or undated (`scanner_signatures_too_old`: nothing is scanned); self-hosted: `docker compose run --rm --no-deps worker main.mjs scanner-check`.

**Orphan objects.** An object can exist in our buckets without a live file record: a generated file whose job rolled back after writing it, or an object a still-valid signed upload URL (hosted: 2 hours) created **again** after the file was quarantined, its object removed or the file purged. Housekeeping lists, at most hourly per worker, objects in our six buckets older than **3 hours** (the longest upload-URL lifetime plus a margin, so no upload or write in flight is touched, and an object created again with a URL is removed once that URL has expired) that no live record owns (`claim_orphan_objects`: the file whose id ends the key, with that key, neither purged nor its object removed — or in `quarantine` while infected), and removes them. Keys of another shape are left to the operators. The sweep reads every object row of Storage: fine at R1 volumes; at millions of objects it needs a cursor (follow-up).

**The sweep's brake and switch.** Many orphans at once are not leftovers but a sign that file records were lost — typically a **database restored** to an earlier point while Storage kept newer objects, or a fault. Above a brake the sweep removes **nothing** and logs an error (hourly): more than `FILE_ORPHAN_SWEEP_MAX` orphans in all (default 500), or — above 50 orphans — more than `FILE_ORPHAN_SWEEP_MAX_SHARE` percent of all objects in our buckets (default 10). `FILE_ORPHAN_SWEEP=off` pauses it (the worker warns at start-up); the rest of housekeeping goes on.

**During a restore** (database or Storage, self-hosted or hosted): set `FILE_ORPHAN_SWEEP=off` on every worker **before** restoring (self-hosted: in the worker's environment, then `docker compose … up -d worker`; hosted: the `production-jobs` variable `FILE_ORPHAN_SWEEP`), reconcile `platform.files` and the buckets (objects without a record after the restore are either restored uploads to re-link or real orphans), then switch it back on. Never raise the brake to get past a restore: removed objects are gone.

## 5. Retention (housekeeping rules)

| Class | Purged | PO decision |
|---|---|---|
| `import` | 7 days after first use (`markFileUsed` — T-M2-12 calls it when the import is confirmed and runs); 24 hours after upload if never used; at once once deleted | 9 Oct 2026 |
| `export` | 24 hours after creation, or once deleted | ADR 0006 §6 (FR-AUD-02) |
| `owner_lifetime` | 30 days after its owner deleted it | ADR 0006 §1 |
| `record` | never by this job (training-record retention ≥ 10 years, DR-5; its own rules come with the records) | — |
| any | `pending_upload` after 24 h; `rejected`/`error` after 30 days; `infected` 30 days after the scan; objects without a live record 3 hours after their creation (orphans, §4) | ADR 0006 §7 |
| purposes **without a scan** (branding images) | the **object** (record kept) once `accepted` with its published copy, once `deleted`, and 24 h after the upload while still `uploaded`; an `uploaded` one no Branding uses is **purged** (object and record) after 24 h — a signed link to raw bytes (hosted Supabase) then stops working (security review M1) | PO, 21 Oct 2026 (RR-TEN-08) |

`legal_hold = true` stops every purge and object removal of that file (set by the platform administrator's tooling, later); housekeeping re-checks it under the file's row lock just before the Storage work, so a hold set after the lease still wins. A file waiting for the scanner is purged by its class's rule like any other (imports: 24 hours after upload if never used), but never while a worker scans it.

## 6. Security notes

- **No service key on the request path.** The web app talks to Storage with the user's session only; the Storage/Auth secret key exists in the worker only (ADR 0002 §7 implementation notes T-M2-17, T-M2-18). dependency-cruiser keeps `@jadarat/platform-files/jobs` and `@jadarat/platform-db/admin` out of `apps/suite`.
- **Signed URLs are created by the server only.** Self-hosted, the gateway serves URL creation (both sign POSTs) on its internal port 8445 for the app's network alone; the published port serves only their use (`PUT` upload with its CORS preflight, `GET` download) — and a download only in the shape the app makes it (token, then a name ending in one of our types' extensions; Storage does not sign the `download` parameter). A module that adds a purpose with a new type adds its extension to `EXTENSION_BY_TYPE` **and** to the gateway's download rule (`infra/docker/gateway/nginx.conf`).
- **Downloads are tied to the authorized owner.** A grant is given only for a file of exactly the owner entity and purpose the module checked (`private.grant_file_download`): a module that authorized entity X can never hand out a file of entity Y. Grants live at most 5 minutes.
- **Logs** carry file ids, purposes, outcomes and codes — never names, contents or URLs (signed URLs carry tokens; download URLs carry the name). Self-hosted Storage logs errors only, and the gateway logs Storage locations at `crit` only (its `error` lines, e.g. a refused method, quote the request line with the token and the name). What remains: `crit` lines (TLS or memory failures) could still quote a request line; hosted Storage's own request logs (Supabase's, not ours) contain the download name of each signed download URL; the orphan sweep logs only bucket names.
- **Downloads** are always attachments with `X-Content-Type-Options: nosniff`, named with the extension of the type found by content; self-hosted, the gateway adds `Content-Security-Policy: default-src 'none'; sandbox`. SVG, HTML and macro-enabled Office files are refused by content; names without an extension of an accepted type are refused at the upload intent.
- **Names** are sanitized in TypeScript and checked again by the database (`files_name_check`).
- **Self-hosted Storage's JWT secret** (`STORAGE_JWT_SECRET`, Storage's `AUTH_JWT_SECRET`) is **admin-equivalent**: Storage accepts any token signed with it, so its holder can forge a service_role token for every object. Only the `storage` container has it (smoke-tested). Rotation: `infra/docker/README.md` ("Files and malware scanning").
- **Hosted project settings.** In the hosted Supabase project, **turn off the S3 protocol** (Storage → Settings → S3 connection; and no S3 access keys) **and image transformation** (Storage → Settings, where the plan offers it): neither is used, and both are ways around our signed-URL paths. Self-hosted, both are off in `compose.yaml` (`S3_PROTOCOL_ENABLED`, `IMAGE_TRANSFORMATION_ENABLED`).
- **Residual risks**, accepted for now:
  - **Hosted: link lifetime and name (TM-0003 RR-FIL-01, register R-58).** Hosted Storage's sign endpoint is reachable with a user's own access token and takes the lifetime from the caller: within a download grant's window (≤ 5 minutes; 60 s for documents) the authorized user can ask for a link of any lifetime to that one file, which works until the object is removed; and the link's saved name is not signed. Bounded by the grant (only users the module authorized for that file and owner entity), audited grant issuance for personal-data purposes, and retention (import files are removed 7 days after use).
  - **Hosted: upload URLs live 2 hours** (not configurable): our 15-minute reservation window bounds when a URL can be **issued**, not when it is used — an upload made later with it is accepted by Storage for that one key and, if confirmed (within 24 hours of the reservation), scanned like any other before any use; an object it creates again after the file was quarantined, removed or purged is an orphan, removed after 3 hours (§4); unconfirmed objects are purged after 24 hours.

## 7. Deployments

**Self-hosted:** `infra/docker` runs Storage (file backend here, S3-compatible in production), clamd and freshclam; see its README ("Files and malware scanning") for the object backend, the public origin (`STORAGE_PUBLIC_URL`), the internal signing port (`STORAGE_INTERNAL_URL`, answering the `edge` network the app and the gateway alone share), the signature mirror and age limit, the Storage JWT secret and upgrade steps.

**Hosted Supabase (staging), after the merge — Product Owner:**
1. **Actions → DB deploy** → `plan`, then `apply`. Creates the file tables, the six private buckets and the three `storage.objects` policies (the migration role can create them on hosted Supabase; simulated in CI by `pnpm db:test:hosted-sim`).
2. **Check Storage's database role** (Supabase → SQL editor): `select distinct usename from pg_stat_activity where usename like 'supabase_storage%';` → expected `supabase_storage_admin`. Our storage policies accept user claims only for that role; another name means every upload is refused (fail closed) — report it.
3. **Turn off the S3 protocol and image transformation** (Supabase → Storage → Settings: "S3 connection" off and no S3 access keys; "Image transformation" off where the plan offers it). Both are unused and would go around our signed-URL paths.
4. **Nothing new in Vercel**: the web app needs no Storage key; `STORAGE_PUBLIC_URL` and `STORAGE_INTERNAL_URL` stay unset on hosted Supabase (the project URL serves both).
5. **Worker** (GitHub environment `production-jobs`; the old project: `staging-jobs`): `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (already needed for password-reset links, T-M2-17) give the worker Storage: housekeeping runs. **File scanning** stays opt-in (Tech Lead decision, 10 Oct 2026): the variable `FILE_SCANNING` = `on` makes each 5-minute pass start clamd on the runner (about 1–2 more minutes per run), with signatures refreshed by freshclam at most once a day (kept in the Actions cache; signatures older than 7 days: nothing is scanned, an error in the run log). If clamd does not start, the pass still sends e-mails and runs housekeeping, without scanning, and the run is marked failed. The run logs are public (public repository): the scan logs file ids, purposes, outcomes and scanner findings only.
6. Storage's global upload limit on the Free plan is 50 MB: enough for imports (20 MB) and photos (10 MB); the 200 MB `materials` bucket (CAT-06, later) needs a paid plan.

**Staging limitation.** Staging has no container host: uploads are scanned only when the scheduled **Jobs** pass runs (every 5 minutes, often later), and only with `FILE_SCANNING=on`. Until then they stay `uploaded` — never clean, never usable. A continuous worker host (clamd running all the time, scans within seconds) is the PO's pending cost decision.

## 8. Follow-ups (not in T-M2-18)

- ~~**T-M2-12**: the upload screen — browser `PUT` with progress, polling `getFileStatus`, calling `markFileUsed` when the import runs; downloads through `grantDownload` + `signDownload` (§3) with the import as owner; self-hosted: add `STORAGE_PUBLIC_URL`'s origin to the CSP `connect-src`.~~ Done with T-M2-12 (`docs/engineering/user-import.md`): the start and download actions follow §3 exactly; the CSP's `connect-src` names exactly `STORAGE_PUBLIC_URL`'s origin — an `https` origin (`http` on localhost) with an exact host, never a wildcard (unit test; the smoke's import journey checks the page's policy against the origin the browser uploads to).
- ~~**T-M2-15b**: profile photos~~ Done with WP-ADM-04 (23 Oct 2026) on the branding-image path, **without `sharp`**: the type is checked by content, the pixel size from the header and the metadata (EXIF/GPS, XMP, comments) removed by `image-info.ts` without decoding a pixel (`profile-photo.ts`); the browser also re-encodes the framed square as a small JPEG. The raw upload is removed from Storage once its copy exists (`file_housekeeping_action`).
- **Notifications of an infected file** to the uploader and the organization's admin (ADR 0006 §3.4): a separate task (Tech Lead, 10 Oct 2026); the `file.scanned` event and the audit events are in place.
- **Quotas** (security review L7): per-tenant storage quota (SUB-01) and a per-tenant cap on pending uploads (today: 50 per user per day), with CAT-06; resumable (TUS) uploads for large materials, 200 MB end-to-end on staging (ADR 0006 Verification 2).
- **Encrypted documents** (security review L8): `AlertEncryptedDoc yes` in `clamd.conf` when the first purpose accepts PDFs or Office documents (encrypted ones then `rejected`, `encrypted`, like archives).
- **Orphan sweep at scale**: a keyset cursor over `storage.objects` once objects number in the millions (§4).

## 9. Security review of 10 Oct 2026 (T-M2-18) — what changed

| Finding | Change |
|---|---|
| M1 one user could stall scanning for every tenant | clamd `MaxScanTime` 90 s, verdict wait 150 s; a dropped stream counts against the file when clamd still answers a PING; failures of the file itself counted separately (`scan_failures`, `error` after 5); suspected crashes (no PING answer) counted too (`scan_crashes`, `error` `scanner_crashed` with a high-severity event after 3 — re-review L-B); no verdict 24 h after upload → `error` (`scanner_unavailable`) with an error log; organizations take turns (`claim_file_scan`); the owner may delete a file waiting for the scanner or failed; housekeeping's retention applies to waiting files (never during a scan); clamd's `/tmp` bounded to 2 GB |
| M2 download links were not short-lived | self-hosted: URL creation only on the gateway's internal port 8445 for the app (`STORAGE_INTERNAL_URL`), the published port serves only `PUT` (+ `OPTIONS`) and `GET`; hosted: residual risk RR-FIL-01 / R-58; grant lifetime ≤ 5 minutes in ADR, migration and docs |
| M3 downloads kept the uploader's extension | download name = sanitized name + extension of the detected type (`downloadName`); upload intents refuse names without an extension of an accepted type (`declaredTypeFor`); self-hosted gateway serves downloads only with such a name |
| M4 grants were not tied to the authorized entity | `grant_file_download(file, purpose, module, entity type, entity id)` and `grantDownload(tx, actor, { fileId, purpose, owner })` (then `signDownload` after the commit — integration review M1) |
| M5 orphan objects were never removed | hourly sweep of objects older than 3 h without a live record (`claim_orphan_objects`) — also the original key of a quarantined, removed or purged file, if a URL created it again; with a configurable brake (500 orphans / 10 % of objects: none removed, an error) and a switch for restores (re-review L-C) |
| L1 signature age | hard limit 7 days (or undated): nothing scanned, error hourly; `scanner-check` exit code 3; raising it needs a test-only flag and no production environment (re-review L-D) |
| L2 users could upload to or confirm a generated file's key | `can_upload_object` and `confirm_file_upload` require a purpose users upload |
| L3 stored content type unchecked | `storage_object_facts.content_type`; confirmation rejects another type than the declared one (`type_mismatch`) |
| L4 gateway logs quoted URLs | `error_log … crit` in the Storage locations (rest: §6 Logs) |
| L5 Storage JWT secret | documented as admin-equivalent with rotation; smoke check: only `storage` holds it |
| L6 legal hold race | lock + re-check + Storage work + record in one transaction (`lock_file_housekeeping`) |
| L7, L8 | follow-ups (§8) |
| Info | pgTAP: Storage's upsert (`insert … on conflict do update … returning *`) refused over uploaded and scanned bytes; hosted S3 protocol and image transformations off (§6, §7); staging: a clamd failure skips scanning only |

**Decisions (Tech Lead, 10 Oct 2026).** Encrypted archives are `rejected` (`encrypted`), not infected, with a low-severity audit event — only for findings starting exactly with `Heuristics.Encrypted.`; any other finding is malware. Files over clamd's limits (`unscannable`: zip bombs, sizes, depth, scan time) get the same low-severity audit event. Staging scanning stays opt-in (`FILE_SCANNING`); e-mails to the Organization Admin about infected files are a separate follow-up task.

## 10. Integration after T-M2-09, T-M2-10 and T-M2-11 (10 Oct 2026)

| Where | What |
|---|---|
| Storage's tenant check | `private.storage_request_tenant()` asks the same decision as `private.current_tenant_id()`, `private.session_access` (T-M2-10): an idle session, one past the organization's maximum length or one that does not meet its MFA policy gets no tenant from Storage (pgTAP 84) |
| Server actions | Transaction step in the handler (`reserveUploadIntent`, `grantDownload` with its audit row), Storage signing in `defineAction`'s `afterCommit` (`signUploadIntent`, `signDownload`; integration review M1) — no `externalEffects`, no second transaction; signing refuses to run inside one; expected refusals as results through `fileResult` / `FileErrors`, an `afterCommit` refusal logged as a warning (L-b) (§3) |
| Supabase server client | one `global` object: T-M2-11's visitor header and T-M2-10's User-Agent together with Storage's routing fetch; `requestFileStorage` forwards the browser's User-Agent (a refresh records the real browser); no visitor or client-address header reaches Storage (integration review L2) |
| Transactions (platform-db) | one open transaction per request or job: `runWithClaims` refuses a nested one before taking a connection (integration review info 2); `inDatabaseTransaction()` / `assertNoDatabaseTransaction()` follow the transaction's own lifetime, also in callbacks bound inside it (Next.js `after()`) |
| Worker | platform tasks: account mail (reset links, lock notices), the session purge (T-M2-10), file housekeeping and the scan |
| Self-hosted smoke | the file journey runs before the sign-in protection, deactivation and security-policy journeys (it signs in with the first account's original password, before the policy requires an authenticator app); `front` (T-M2-11) and Storage/clamd in the service checks |
| Bulk user import (T-M2-12, the first consumer) | `startUserImport`: `reserveUploadIntent` and the import in the handler, `signUploadIntent` in `afterCommit`; `downloadUserImportReport`: `grantDownload` (with the import's audit record) in the handler, `signDownload` in `afterCommit`; `fileResult` everywhere; no `externalEffects`. The worker's import task uses `createWorkerFiles` (`openScannedFile`, `storeGeneratedFile`) with the job's own transaction — never one inside another. Its smoke journey runs right after the file journey, for the same reason |
