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
| Invitations from imports (held, scheduled, released; sign-in rule; the platform-wide send clock) | migration `20261016090100_platform__invitations_from_imports.sql` |
| People removed by an undo (marker, invisible to users) | migration `20261016090150_platform__persons_removed_by_import_undo.sql` |
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
| `finished` / `stopped` / `failed` | Result with counts, error report, undo | — (`stopped`: the importer asked; `failed`: the importer lost the right to import, or a step failed 6 times). The run always ends, also when its error report cannot be made (`report_code`, §5) |
| `undoing` → `undone` | Progress, then result | the worker, batches of 500; `failed` with `UNDO_NOT_ALLOWED` when the member who asked may no longer undo it, `UNDO_FAILED` after 6 failures (what was undone stays; the undo can be asked for again within the 7 days) |
| `cancelled` / `expired` / `rejected` | A card with «رفع ملف آخر» | — (`expired` with `UPLOAD_NOT_FINISHED`: the file never arrived, §11) |

Only the **importer** sees the steps before the run and the review, and only they download the list of problems and the error report (the file holds employees' data, PO decision 9); every holder of the permission sees the running import's progress and every import's counts. One import **runs** at a time per organization (unique index; `ANOTHER_IMPORT_RUNNING`). A person may have at most **5** imports not yet run (uploaded … review, review window open), an organization **20** (`TOO_MANY_DRAFTS`; security review H1): each one may cost the worker a read and a dry run. An import whose file never arrived stops counting once its **upload window** has passed — the file reservation's own expiry, 15 minutes (`upload_due_at`, integration review M1, §11) — and its importer can cancel any import not yet run from its card or the list of recent imports.

## 2. Rules the import applies

- **Who:** an active Organization Admin or HR Manager (`private.user_import_actor_may_import`), read again by the database whenever the import writes — a demoted, deactivated or removed importer's import stops (`failed`, `IMPORTER_NOT_ALLOWED`; also when the invitation guard refuses the schedule, or during the dry run), no error report is made for them (it is theirs alone: `report_code` `IMPORTER_NOT_ALLOWED`), and its held invitations are no longer sent. Updating existing people needs `platform.user.update` too. **Undo:** the importer, or any Organization Admin (§6).
- **No authenticator code to start (TM-0003 D-IAM-01; integration T-M2-10 × T-M2-12, 10 Oct 2026).** The single-user flows ask for a fresh authenticator code (AAL2, code from the last 15 minutes, whatever the organization's MFA policy) only on their privileged path — `platform.role.assign_privileged` (high risk), which gives or takes a privileged role. An import never gives one: the default role is never privileged (input, lifecycle trigger), a file's privileged roles are row errors (`ROLE_PRIVILEGED`, `ROLE_ORG_ADMIN`), an update never changes roles, and the invitation guard refuses an import invitation with a privileged role (tested with rows a defective worker might stage: they fail, `NOT_ALLOWED`). Starting an import is therefore the ordinary invite — `platform.user.invite` (medium risk), like inviting one person with ordinary roles; updating existing people is the ordinary edit — `platform.user.update`, a privileged member's record by an Organization Admin only, as the edit form. If a future change lets an import give a privileged role, its run must use the privileged path (`platform.role.assign_privileged`) — `actions.test.ts` fails first.
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
| `read` | Streams the scanned file (`openScannedFile`), lists sheets, columns and up to 3 sample values (never for excluded columns); gives up after **5 minutes** (`FILE_UNREADABLE`) |
| `validate` | Reads the chosen sheet again, stages the mapped values in batches of 500, runs the dry run in the database, writes the list of problems (XLSX, `platform.user_import_report`); gives up after **10 minutes**; ends `failed` (`IMPORTER_NOT_ALLOWED`) when the importer may no longer import |
| `run` | Fresh check, then batches of **500 rows per transaction** with a checkpoint each (`rows_done`): a restart continues after the last committed batch; stop requests are honoured between batches; then the invitations are scheduled and the error report written (in a savepoint: §5) |
| `send` | Releases due held invitations **one per transaction** at the platform-wide pace and under the organization's daily number (§4); at most 30 per turn, then the next import |
| `undo` | Batches of 500 in reverse order; each batch first checks that the member who asked may still undo it (§6) |
| `expire` / `purge` | Unconfirmed reviews after 24 hours, and imports still waiting for their file once the upload window has passed (`UPLOAD_NOT_FINISHED`, §11); files and staged rows 7 days after the end (at once for refused, cancelled and expired imports) |

A pass hands over after **4 minutes** (the next pass is queued at once). A failed step is retried after 2ⁿ minutes (at most an hour); after **6** failures the import ends as `failed` (what was added stays and is in the error report). Every transaction of a step renews its lease, and reading a file renews it every 1,000 rows; a step that outlives its lease anyway counts as a failure (with the back-off), so it cannot be claimed forever. Work stays bounded (security review H1): files are streamed (an XLSX part is inflated 4 KB of input at a time, every part of one file shares a **256 MB** budget, a sheet part at most 128 MB, shared strings 64 MB, two sheets on the same part are refused), the reader yields to the event loop every megabyte, cells are cut to 32,767 characters before they are cleaned, rows are staged in batches, the report is built page by page (1,000 rows). Logs carry import ids, steps, codes and counts — never names, addresses, cells or file names.

## 4. Invitations

Every person added gets an invitation created **held** (`mail_held`, no token, no e-mail) in the same transaction. Then:

- **«إرسال الدعوات فور انتهاء الاستيراد»** (default): when the rows are done the import schedules them (`send_at`, the earliest time each may go) one after the other at the pace, and the worker releases them; the invitation mailer (`platform-identity`, event `com.entlaqa.platform.invitation.released`) e-mails each one and its 7 days start then (PO decision 6).
- **The pace is the installation's, not the import's** (security review M2): every release takes a slot of the **send clock** (`private.invitation_send_clock`, one row; `private.take_invitation_send_slot`, owner `user_import_guard`): one import invitation at a time for every organization together, `USER_IMPORT_INVITATION_INTERVAL_MS` apart (default 1,000; **at least 500**, since Resend allows 2 requests a second for the whole account; checked at start-up). Invitations that are overdue — the worker was down, many imports finished together — are therefore spaced out again, never sent in a burst; a worker sends at most 30 of one import per turn and then serves the next import (the one waiting longest). An organization sends at most `USER_IMPORT_DAILY_INVITATIONS` import invitations per UTC day (default 5,000; `USER_IMPORT_TRIAL_DAILY_INVITATIONS`, default 200, on trial — counted on `released_at`); above it the rest wait until the next day, still scheduled — never dropped. The same values must be set on every worker. What this means in practice:
  - **Turns go round imports, not organizations:** an organization with two imports sending at the same time gets two turns in each round (the daily number still applies to the organization as a whole).
  - **Capacity:** at one a second the installation sends at most 86,400 import invitations a day — about **17 organizations** sending their full 5,000. Beyond that, invitations wait for their turn (later the same day, or the next).
  - **Suspension:** an organization suspended while a turn is under way can still have **up to one turn (30)** released before the worker notices: the claim skips suspended organizations, but within a turn only the importer's right is read again for each invitation (a demoted importer stops at once), not the organization's status.
  - **The pace governs the release only:** each released invitation is mailed once by the invitation mailer; a delivery that fails and is retried (provider errors, rate limits, email.md §1) follows the mailer's own back-off, not the send clock.
- **«الإضافة دون إرسال الدعوات الآن»**: they stay held. The users list shows them under «مدعو» as «لم تُرسل الدعوة» with «إرسال الدعوة» per person and a banner with «إرسال الدعوات (N)» for the latest such import; both schedule them at the same pace (`private.schedule_held_invitations`).
- **With T-M2-09:** a held invitation does not let a login that belongs nowhere sign in (`private.account_sign_in_refused` counts only sent invitations); deactivating a person revokes their pending invitations, held ones included; a revoked or accepted invitation is never released; the mailer re-checks that the inviter may still manage the invitation.
- **Provider limits (Resend, regional SaaS):** the default API rate limit is **2 requests per second** per team (the whole installation) and the plan sets daily and monthly sending quotas (the free plan: 100 a day, 3,000 a month). Import invitations use at most one request a second **in total** (the send clock), whatever the number of organizations importing, which leaves the other half for every other e-mail (invitations by hand, password resets); a 429 is still waited out by the sender (email.md §1). **10,000 invitations take about 3 hours** when one organization sends alone — longer when several share the clock, and over two days with the default daily number — and need a plan whose quota allows them: check Resend → Usage before a large import, or choose «الإضافة دون إرسال الدعوات الآن» and send in parts. Self-hosted relays have their own limits; set the pace for them.

## 5. The list of problems and the error report

Both are **XLSX** workbooks (security review L2): one sheet («قائمة المشكلات» / «تقرير الأخطاء», right to left for an Arabic importer), a frozen bold header, text-formatted columns, every cell an **inline string**. They are written by the worker to the `generated` bucket (purpose `platform.user_import_report`, XLSX only) and **downloadable by the importer only**, through a 60-second link (download grants of ADR 0006 §4); every download is audited (`platform.user_import.report_downloaded`). Columns (approved screen 11): the row number in the file, the outcome, the reason in Arabic and in English, the reason code, then **the file's imported columns with the row's values** as in the file (so the HR team can fix the rows and import them again — PO decision 9; column headers in the importer's language when the file had none). Rows: refused, skipped, and added or updated with warnings.

**Formula injection** (TM-0003 T-IAM-19): an inline string is never a formula, so a cell such as `=HYPERLINK(…)` opens as the text it was — exact, without the leading `'` a CSV needs (`neutralizeFormula` is kept for the CSV template and the CSV reader, which removes such a quote again). **Downstream exports:** a name or other value imported with a leading `=`, `+`, `-`, `@`, tab or carriage return is stored as it was (it is valid text); every later export of people's data — CSV above all — must neutralize such cells itself (SCS-6.6), as these reports and any future people export do.

**When no error report is made** (security review M1): the report is the importer's alone, so none is made when they may no longer import (`report_code` `IMPORTER_NOT_ALLOWED`); it is stored in a savepoint, so a storage fault is tried again with the step and, after the step's last attempt, the run ends without it (`REPORT_FAILED`). The result page says which, and the reasons by row count stay on the page and in the audit record.

## 6. Undo (7 days)

Available until 7 days after the end, unless the data was purged (approved screen 12, PO decision 10; BRD §10.4), to the **importer** while they may still import — and, by Tech Lead decision (10 Oct 2026, security review M1), to **any Organization Admin** of the organization for any import, also one whose importer is gone (`private.user_import_actor_may_undo`: the lifecycle guard, the RLS policy `user_imports_admin_undo`, the request path). An HR Manager undoes only their own imports. The undo dialog's numbers come from the result and the import's invitations, so an Organization Admin sees them without the staged rows (which stay the importer's). Every batch checks again that the member who asked may still undo it (security review L1); if not, the undo ends `failed` (`UNDO_NOT_ALLOWED`, audited) and what was undone stays. It works backwards through the import's rows:

- **Added people** whose invitation is still pending: the invitation is revoked (audited) and the person is **removed, as if never added** (migration `20261016090150`): the record is marked (`removed_at`, `removed_by_import_id`), inactive, and invisible to every user — no users-list tab, search, count, profile, picker or later import shows or matches it — and its work e-mail and employee number are free for a new invitation or import (a new record). It is kept only for the audit trail and referential integrity (the import's rows, the revoked invitation and audit events point at it); only the undo of the import that created the person can mark it, and a removed record never changes again. A removed person never had a usable invitation: a held one has no token; a sent one is revoked, so its link, the sign-up gate and acceptance refuse it. People who **accepted** their invitation, or whom others now reference (a manager of an active person, a department head), are **kept** and counted; a person the import only **reused** (an earlier record without account) is put back as it was, never removed.
- **People the import invited again** (an earlier record without account): put back as they were — unless their record changed since the import (version check, security review L1): then they are kept as they are, invitation included (`kept_changed`).
- **Updated people:** their previous values are restored — unless someone changed them since (version check), then they are kept and counted (`kept_changed`). When the member who asked for the undo is not an Organization Admin, people who **hold a privileged role now** keep their data (`kept_privileged`: an HR Manager never changes such a record, TM-0003 T-IAM-18).

The undo's numbers are kept with the result (`result_counts.undo`) and the result page shows what was removed, kept and restored (`result.undoCounts`, `result.undoKeptPrivileged`, `result.undoKeptError`).

## 7. Audit events and domain events

| Audit action | Data (never names, addresses, cells or file names) |
|---|---|
| `platform.user_import.uploaded` | `fileId` |
| `platform.user_import.mapped` | sheet index, the mapped field names |
| `platform.user_import.confirmed` | options (existing, default role, invitations), review counts |
| `platform.user_import.finished` / `stopped` / `failed` | counts, failure code, report code when no error report was made (worker, job id) |
| `platform.user_import.undone` / `undo_failed` | the undo's counts by result; `undo_failed`: `UNDO_NOT_ALLOWED` or `UNDO_FAILED` |
| `platform.user_import.cancelled`, `stop_requested`, `undo_requested` (reason code; by the importer or an Organization Admin) | — |
| `platform.user_import.expired` | `reason`: `review_window` (not confirmed in 24 hours) or `upload_window` (the file never arrived) — worker, job id |
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
| Invitations of an import not arriving | `select count(*) filter (where mail_held and send_at is null) as held, count(*) filter (where mail_held and send_at is not null) as scheduled, count(*) filter (where not mail_held) as released from platform.invitations where import_id = '<import id>' and status = 'pending'`; released ones go through the e-mail log (email.md §4). Scheduled ones wait for the send clock (`select next_slot from private.invitation_send_clock`) and the organization's daily number: `select count(*) from platform.invitations where tenant_id = '<organization id>' and released_at >= date_trunc('day', now(), 'UTC')` — at the number, the import's `next_attempt_at` is the next UTC midnight (the worker logs "daily number of invitations is reached") |
| An organization needs more invitations a day | Raise `USER_IMPORT_DAILY_INVITATIONS` (or the trial number) on **every** worker and restart them; check the provider's quota first (§4) |
| A person must not keep data from an undone import | Undo already made them inactive; deleting a person is a people-directory decision (retention), not an import one |

## 10. Deployments

**Self-hosted:** beyond T-M2-18 (the workers need Storage — `SUPABASE_URL`, `SUPABASE_SECRET_KEY` — and clamd; the app's CSP allows `STORAGE_PUBLIC_URL`'s origin for the browser's upload; the gateway answers the upload's CORS preflight for `APP_BASE_URL`), the workers read `USER_IMPORT_INVITATION_INTERVAL_MS`, `USER_IMPORT_DAILY_INVITATIONS` and `USER_IMPORT_TRIAL_DAILY_INVITATIONS` (defaults in `infra/docker/compose.yaml`; checked at start-up).

**Hosted Supabase (staging), after the merge — Product Owner:**
1. **Actions → DB deploy** → `plan`, then `apply` (four migrations, `20261016090000` … `20261016090200`, after T-M2-18's).
2. The import task runs only in a worker that has Storage: `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the GitHub environment `staging-jobs` (already needed for T-M2-17 and T-M2-18), and `FILE_SCANNING` = `on` so uploads are scanned. Without them uploads stay «جارٍ فحص الملف» and expire after 24 hours. The sending settings keep their defaults unless the PO decides other numbers: then set the `staging-jobs` variables `USER_IMPORT_INVITATION_INTERVAL_MS`, `USER_IMPORT_DAILY_INVITATIONS`, `USER_IMPORT_TRIAL_DAILY_INVITATIONS` (passed by `.github/workflows/jobs-staging.yml`; unset = the defaults).
3. Nothing new in Vercel.

**Staging limitation:** the worker runs one pass every 5 minutes, so each step (scan, read, dry run, run, invitations) waits for the next pass — an import takes several passes; run **Jobs (staging)** by hand to go faster. A continuous worker host is the PO's pending decision.

## 11. Integration with T-M2-09, T-M2-10, T-M2-11 and T-M2-18 (10 Oct 2026)

| Where | What |
|---|---|
| Files (T-M2-18 final API, `files.md` §3, §10) | `startUserImport`: in the action's transaction `reserveUploadIntent` and the import; after the commit (`afterCommit`, once, no connection held) `signUploadIntent` with the user's Storage session (`requestFileStorage`). `downloadUserImportReport`: in the transaction the import's own check, `grantDownload` (with the files service's audit event) and the import's audit record `platform.user_import.report_downloaded` (both record the 60-second grant); after the commit `signDownload`. `confirmUserImportUpload`: `confirmUpload` in the transaction. Every call through `fileResult`: refusals are answers with the files service's codes (`FILE_TOO_LARGE`, `FILE_STORAGE_UNAVAILABLE`, … — the screens show the import's own wording for them); a purged or unclean report stays `REPORT_DELETED`. **No import action declares `externalEffects`**: nothing outside the database happens in a handler, so `defineAction`'s one retry after a deadlock stays on. If Storage fails after the commit, what stays is what a cut upload leaves — an import waiting for its file — or an unused 60-second grant. **Such an import never locks its importer out** (integration review M1): it carries the file reservation's expiry as its upload window (`upload_due_at`, copied when the import is created — 15 minutes, the same on hosted and self-hosted Supabase), stops counting toward the per-person and per-organization limits of imports not yet run once that window has passed (`private.user_import_upload_abandoned`), and the worker then expires it (`expired`, failure code `UPLOAD_NOT_FINISHED`, audited `platform.user_import.expired` with reason `upload_window`; the purge deletes the reservation). Confirming the upload closes the window (the importer's own update, refused while the file is still `pending_upload`), so an import whose file arrived keeps its 24-hour review. The cut-upload card offers «إعادة الرفع» (cancels this import, then opens step 1) and «إلغاء الاستيراد»; the list of recent imports offers «إلغاء» on the importer's own imports not yet run; the upload panel cancels the import itself when the upload is cut or refused. The card no longer says «لم يُحفظ شيء» / "nothing was saved" (the import record stays with the audit log, PO decision 8): it says the upload did not finish and the file can be uploaded again |
| Worker | the import task gets `createWorkerFiles({ store })` from `apps/worker` and works in its own `withSystemTx` / `withPlatformTx` transactions — never one inside another (platform-db refuses that now); the platform tasks are the account mail, the session purge (T-M2-10), file housekeeping, the imports and the scan |
| Sessions and step-up (T-M2-10) | every import action goes through `defineAction`, so the organization's session rules and MFA policy apply (an inactive session gets `UNAUTHENTICATED`); no step-up (§2) |
| Deactivation (T-M2-09) | a deactivated member is skipped (`MEMBER_DEACTIVATED`), the invitation guard refuses an inactive person or one with a membership, a removed person is invisible to it; a held invitation never lets a login that belongs nowhere sign in (`private.account_sign_in_refused` counts sent invitations only — T-M2-12's definition keeps T-M2-09's rule otherwise unchanged) |
| CSP | `connect-src` names exactly `STORAGE_PUBLIC_URL`'s origin (an https origin, http on localhost, with an exact host — never `*`); unit test, and the smoke's import journey compares the page's policy with the origin the browser uploads to |
| Guard role | `user_import_guard` is in every guard list: hosted simulation, `10_catalog.sql`, `verify-deployment.sql` (10 roles; its read policy on `platform.files` allowed for it alone), the no-privilege lists of `64_`, `68_`, `70_` and the files block; and every other guard has no privilege on the import tables or the send clock |
| Self-hosted smoke | the import journey runs right after the file journey, with the first account's original password, before the T-M2-11 lockout, the T-M2-09 deactivations and the T-M2-10 policy (MFA required) change the accounts |
| pgTAP fixtures | the import fixtures' ids end in `e0n` (T-M2-10's security fixtures use `c0n`) |
