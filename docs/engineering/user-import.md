# Bulk user import (runbook)

| | |
|---|---|
| **Backlog** | T-M2-12 · FR-IAM-04 (import), FR-IAM-03 (its invitations) · BRD §10.4 (dry run, undo) · NFR-PERF-05 |
| **Design** | Approved screens and the 13 PO decisions of 9 Oct 2026: [`docs/design/screens/m2-user-import/`](../design/screens/m2-user-import/README.md) (build differences in its §"Build notes") |
| **Architecture** | ADR 0005 (jobs: a platform task), ADR 0006 (files: scanned before reading), ADR 0004 (events), ADR 0008 (e-mail), ADR 0002/0003 (tenancy, authorization) |
| **Security** | TM-0003 T-IAM-18, 19, 20, 30, 33, 34, 45–48 · TM-0004 T-PEO-20 (no personal data in logs) |
| **Related runbooks** | [files.md](files.md) · [background-jobs.md](background-jobs.md) · [email.md](email.md) · [invitations-contract.md](invitations-contract.md) |

An Organization Admin or HR Manager adds or updates up to **10,000 people from one CSV or XLSX file**: they download a template (optional), upload the file (scanned for malware first), map its columns, review a **dry run** of every row with a downloadable list of problems, choose options, confirm, and the worker adds the people in batches with progress; then they download the error report and may **undo** the import for 7 days. People added get invitations through the invitation system of T-M2-07 — at once, or later («لم تُرسل الدعوة»).

| Piece | Where |
|---|---|
| Tables, lifecycle guard, one running import per organization | migration `20261016090000_platform__user_imports.sql` (`platform.user_imports`, `platform.user_import_columns`, `platform.user_import_rows`, role `user_import_guard`) |
| Invitations from imports (held, scheduled, released; sign-in rule) | migration `20261016090100_platform__invitations_from_imports.sql` |
| Processing (dry run, fresh check, batches, undo, purge) | migration `20261016090200_private__user_import_processing.sql` |
| Spreadsheets (own CSV parser and writer, XLSX reader on a bounded ZIP reader + `saxes`, XLSX writer) | `packages/platform-import/src/spreadsheet` |
| Fields, header recognition, roles, row checks, issue catalogue (AR/EN), template, report | `packages/platform-import/src/users` |
| Actions and queries (permission `platform.user.invite`) | `packages/platform-import/src/actions.ts` → `apps/suite/src/actions/user-import.ts`, `apps/suite/src/lib/user-import-queries.ts` |
| Worker task `platform.user_imports` | `packages/platform-import/src/jobs` (jobs code only — dependency-cruiser), registered in `apps/worker/src/platform-tasks.ts` |
| Database helpers | `@jadarat/platform-db` (`user-imports.ts`), `@jadarat/platform-db/jobs` (`jobs/user-imports.ts`) |
| Screens | `apps/suite/src/app/[locale]/suite/admin/users/import/` (step 1, the template route, `[importId]` for every later step and state), `apps/suite/src/components/user-import/`; users list banners and «إرسال الدعوة» |
| Tests | pgTAP `supabase/tests/85`–`88_user_imports_*.sql`; unit tests next to the code; `platform-import/src/jobs/user-import.integration.test.ts`; E2E `apps/suite/e2e/user-import.spec.ts` (Arabic and English) in the self-hosted smoke (`infra/docker/smoke-import.sh`) |

## 1. The journey and its statuses

| Status | Screen | Moves on by |
|---|---|---|
| `uploaded` | «جارٍ فحص الملف» / «جارٍ قراءة الملف» (polls) | the file service's scan; then the worker reads the sheets and columns → `mapping`, or `rejected` with a code (`FILE_INFECTED`, `FILE_ENCODING`, `FILE_PROTECTED`, `FILE_MACROS`, `FILE_TOO_MANY_ROWS`, …) |
| `mapping` | Step 2: sheet, columns with three sample values, recognized / suggested / never imported | the importer chooses the mapping → `validating` |
| `validating` | «جارٍ فحص الصفوف» (polls) | the worker checks and stages every row (the dry run), writes the list of problems → `review` |
| `review` | Step 3 (counts, grouped reasons, tabs), step 4 options and step 5 confirmation (options travel in the URL) | the importer confirms → `queued` (the review is valid **24 hours** from the upload; then `expired`) |
| `queued` → `checking` → `importing` → `inviting` | Progress (polls; anyone with the permission sees it) | the worker: fresh check of every row against the data as it is now, batches of 500, then the invitations |
| `finished` / `stopped` / `failed` | Result with counts, error report, undo | — (`stopped`: the importer asked; `failed`: the importer lost the right to import, or a step failed 6 times) |
| `undoing` → `undone` | Progress, then result | the worker, batches of 500 |
| `cancelled` / `expired` / `rejected` | A card with «رفع ملف آخر» | — |

Only the **importer** sees the steps before the run and the review, and only they download the list of problems and the error report (the file holds employees' data, PO decision 9); every holder of the permission sees the running import's progress and every import's counts. One import **runs** at a time per organization (unique index; `ANOTHER_IMPORT_RUNNING`).

## 2. Rules the import applies

- **Who:** an active Organization Admin or HR Manager (`private.user_import_actor_may_import`), read again by the database whenever the import writes — a demoted, deactivated or removed importer's import stops (`failed`, `IMPORTER_NOT_ALLOWED`) and its held invitations are no longer sent. Updating existing people needs `platform.user.update` too.
- **Matching:** by the work e-mail. An employee number that belongs to someone else is an error (`KEY_CONFLICT`, `EMPLOYEE_NUMBER_TAKEN`); the same e-mail or employee number twice in the file refuses every such row (`*_DUPLICATE_IN_FILE`).
- **Never imported:** account status, passwords, privileged roles (Organization Admin, HR Manager, Finance Manager, Compliance Officer, Auditor — `ROLE_PRIVILEGED`, `ROLE_ORG_ADMIN`, PO decision 3), restricted data (gender, birth date, national ID). The mapping offers only the 20 fields of `IMPORT_FIELDS`; columns that look like the excluded data are shown as «لا يُستورد».
- **Existing people:** skipped (default), updated, or updated only (no one added). An update never changes the work e-mail, roles or account status, and **an empty cell never clears a value**. An HR Manager's import never changes holders of privileged roles (`PRIVILEGED_MEMBER`, as the edit form); the importer's own row is skipped (`OWN_ROW`); deactivated members and pending invitations are skipped (`MEMBER_DEACTIVATED`, `INVITATION_PENDING`).
- **Organization data:** departments and branches by code or name (`*_NOT_FOUND` and `*_AMBIGUOUS` are warnings: the value stays empty), managers by e-mail — in the organization or earlier in the file (`MANAGER_LOOP`, `MANAGER_SELF` are errors).
- **Limits:** 20 MB, 10,000 data rows on the chosen sheet, 200 columns, 50 sheets, 32,767 characters per cell; UTF-8 only for CSV (a BOM is accepted; Windows-1256 is refused with `FILE_ENCODING` and a hint to save as «CSV UTF-8»); no password-protected or macro workbooks (`.xlsm` content), no DTDs in XLSX parts.
- **Fresh check at the run:** rows changed since the review are not imported (`CHANGED_SINCE_REVIEW` and the specific codes such as `EMPLOYEE_NUMBER_TAKEN`) and appear in the error report.

## 3. The worker task

`platform.user_imports` is a platform task (ADR 0005 §2b): it runs on every wake-up and every minute, claims imports that need a step through `private.claim_user_import_work()` (owner `user_import_guard`; the import waiting longest goes first, so imports take turns) with a **15-minute lease**, and does each step in the import's tenant transactions (`withSystemTx`, claims `tenant_id` + `job_id`), each checking the lease.

| Step | Work |
|---|---|
| `read` | Streams the scanned file (`openScannedFile`), lists sheets, columns and up to 3 sample values (never for excluded columns) |
| `validate` | Reads the chosen sheet again, stages the mapped values in batches of 500, runs the dry run in the database, writes the list of problems (CSV, `platform.user_import_report`) |
| `run` | Fresh check, then batches of **500 rows per transaction** with a checkpoint each (`rows_done`): a restart continues after the last committed batch; stop requests are honoured between batches; then the invitations are scheduled and the error report written |
| `send` | Releases held invitations whose time has come (100 per transaction) |
| `undo` | Batches of 500 in reverse order |
| `expire` / `purge` | Unconfirmed reviews after 24 hours; files and staged rows 7 days after the end (at once for refused, cancelled and expired imports) |

A pass hands over after **4 minutes** (the next pass is queued at once). A failed step is retried after 2ⁿ minutes (at most an hour); after **6** failures the import ends as `failed` (what was added stays and is in the error report). Memory stays bounded: files are streamed, rows staged in batches, the report written page by page (1,000 rows). Logs carry import ids, steps, codes and counts — never names, addresses, cells or file names.

## 4. Invitations

Every person added gets an invitation created **held** (`mail_held`, no token, no e-mail) in the same transaction. Then:

- **«إرسال الدعوات فور انتهاء الاستيراد»** (default): when the rows are done the import schedules them (`send_at`) one after the other at **one per second** and the worker releases them when due; the invitation mailer (`platform-identity`, event `com.entlaqa.platform.invitation.released`) e-mails each one and its 7 days start then (PO decision 6).
- **«الإضافة دون إرسال الدعوات الآن»**: they stay held. The users list shows them under «مدعو» as «لم تُرسل الدعوة» with «إرسال الدعوة» per person and a banner with «إرسال الدعوات (N)» for the latest such import; both schedule them at the same pace (`private.schedule_held_invitations`).
- **With T-M2-09:** a held invitation does not let a login that belongs nowhere sign in (`private.account_sign_in_refused` counts only sent invitations); deactivating a person revokes their pending invitations, held ones included; a revoked or accepted invitation is never released; the mailer re-checks that the inviter may still manage the invitation.
- **Provider limits (Resend, regional SaaS):** the default API rate limit is **2 requests per second** per team and the plan sets daily and monthly sending quotas (the free plan: 100 a day, 3,000 a month). The import's pace (1 per second) stays under the rate limit and leaves room for other e-mails; a 429 is waited out by the sender (email.md §1). **10,000 invitations take about 3 hours** to leave and need a plan whose quota allows them — check Resend → Usage before a large import, or choose «الإضافة دون إرسال الدعوات الآن» and send in parts. Self-hosted relays have their own limits; the pace is the same.

## 5. The list of problems and the error report

Both are CSV (UTF-8 with BOM, CRLF), written by the worker to the `generated` bucket and **downloadable by the importer only**, through a 60-second link (download grants of ADR 0006 §4); every download is audited (`platform.user_import.report_downloaded`). Columns (approved screen 11): the row number in the file, the outcome, the reason in Arabic and in English, the reason code, then **the file's imported columns with the row's values** as in the file (so the HR team can fix the rows and import them again — PO decision 9; column headers in the importer's language when the file had none). Rows: refused, skipped, and added or updated with warnings.

**Formula injection** (TM-0003 T-IAM-19): every cell that a spreadsheet would run — starting with `=`, `+`, `-`, `@` (also full-width `＝＋－＠`, also after leading spaces), a tab or a carriage return — is written with a leading `'` (`neutralizeFormula`), so it opens as text.

## 6. Undo (7 days)

Available to the **importer** (while they may still import) until 7 days after the end, unless the data was purged (approved screen 12, PO decision 10; BRD §10.4). It works backwards through the import's rows:

- **Added people** whose invitation is still pending: the invitation is revoked (audited) and the person becomes inactive (the record stays, as the people directory never deletes people). People who **accepted** their invitation, or whom others now reference (a manager of an active person, a department head), are **kept** and counted.
- **Updated people:** their previous values are restored — unless someone changed them since (version check), then they are kept and counted.

The result shows what was removed, kept and restored (`result.undoCounts`).

## 7. Audit events and domain events

| Audit action | Data (never names, addresses, cells or file names) |
|---|---|
| `platform.user_import.uploaded` | `fileId` |
| `platform.user_import.mapped` | sheet index, the mapped field names |
| `platform.user_import.confirmed` | options (existing, default role, invitations), review counts |
| `platform.user_import.finished` / `undone` | counts (worker, job id) |
| `platform.user_import.cancelled`, `stop_requested`, `undo_requested` (reason code), `undo_failed` | — |
| `platform.user_import.report_downloaded` | which (`review` or `report`) |
| `platform.invitation.created` / `revoked` | person id, roles, import id (each person, worker) |
| `platform.invitation.send_requested` | number scheduled |

Domain events: `com.entlaqa.platform.user_import.mapped`, `.confirmed`, `.undo_requested`, `.invitations_scheduled` (they wake the worker), and `com.entlaqa.platform.invitation.created` / `.released` / `.revoked`.

## 8. Retention

| What | Kept |
|---|---|
| Uploaded file, list of problems, error report (`retention_class` `import`) | 7 days after first use, 24 hours if never used; then housekeeping deletes them (files.md §5). The upload is first used when the run starts, the error report when it is written; the review's list of problems is never "used", so it goes after 24 hours, with the review |
| Staged rows and columns (personal data) | Deleted with the files: 7 days after the end; at once for refused, cancelled and expired imports; 24 hours for unconfirmed reviews |
| The import record (who, when, file name, options, counts) | With the audit log (PO decision 8) |

## 9. Operations

All queries as the database owner (SQL editor); never copy row values into tickets or chat.

| Situation | What to do |
|---|---|
| An import stays «جارٍ فحص الملف» | The file waits for the scanner: `select status, status_reason from platform.files where id = (select file_id from platform.user_imports where id = '<import id>')`. Staging scans only when the **Jobs (staging)** pass runs with `FILE_SCANNING=on` (files.md §7) |
| An import does not move on | `select status, failures, next_attempt_at, lease_until, failure_code, updated_at from platform.user_imports where id = '<import id>'` — a lease in the future means a worker holds it; failures back off up to an hour (`next_attempt_at`). Check the worker logs for the import id |
| Stop a running import | The importer's «إيقاف الاستيراد» (stops after the current batch). Never update the status by hand: the lifecycle guard refuses it, and half-written batches are what checkpoints prevent |
| «يجري استيراد آخر الآن» | One import runs per organization; wait for it, or its importer stops it |
| Invitations of an import not arriving | `select count(*) filter (where mail_held and send_at is null) as held, count(*) filter (where mail_held and send_at is not null) as scheduled, count(*) filter (where not mail_held) as released from platform.invitations where import_id = '<import id>' and status = 'pending'`; released ones go through the e-mail log (email.md §4) |
| A person must not keep data from an undone import | Undo already made them inactive; deleting a person is a people-directory decision (retention), not an import one |

## 10. Deployments

**Self-hosted:** nothing new beyond T-M2-18: the workers need Storage (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`) and clamd; the app's CSP allows `STORAGE_PUBLIC_URL`'s origin for the browser's upload; the gateway answers the upload's CORS preflight for `APP_BASE_URL`.

**Hosted Supabase (staging), after the merge — Product Owner:**
1. **Actions → DB deploy** → `plan`, then `apply` (three migrations).
2. The import task runs only in a worker that has Storage: `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the GitHub environment `staging-jobs` (already needed for T-M2-17 and T-M2-18), and `FILE_SCANNING` = `on` so uploads are scanned. Without them uploads stay «جارٍ فحص الملف» and expire after 24 hours.
3. Nothing new in Vercel.

**Staging limitation:** the worker runs one pass every 5 minutes, so each step (scan, read, dry run, run, invitations) waits for the next pass — an import takes several passes; run **Jobs (staging)** by hand to go faster. A continuous worker host is the PO's pending decision.
