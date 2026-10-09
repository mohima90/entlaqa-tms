# M2 — Bulk user import screens (draft for PO review)

> **Status:** Draft for PO review, 9 Oct 2026 · Task **T-M2-12** phase 1 (design only, no code) · Epic `EP-M2-IAM`
> **Requirements:** FR-IAM-04 (bulk import), FR-IAM-03 (invitations), FR-IAM-01 (profile fields), FR-IAM-07 (roles) · BR-IAM-1, BR-IAM-3, BR-IAM-4 · NFR-SEC-08, NFR-PERF-05, NFR-UX-01 · BRD §10.4 (import with dry run, error report and rollback) · FR-NTF-02 (e-mails through our notification service)
> **Builds on:** the approved users & roles screens ([`../m2-users-roles/`](../m2-users-roles/README.md)), ADR 0005 (background jobs), ADR 0006 (file storage and scanning), ADR 0008 (notifications), threat models TM-0003 and TM-0004 (import threats)

## How to view

- Open any `.dc.html` file in a browser (double-click). The screens are static (no canvas bindings), so they render without the design-canvas runtime; the `support.js` line is kept only so the files load on the canvas like the approved ones. Start with `Entry.dc.html` and follow the buttons: the links follow the flow.
- Fonts come from Google Fonts; offline, the browser falls back to a system font.
- Phone: the browser's device toolbar at 360–390 px. All screens stack into one column.
- Names, e-mails and numbers are sample data («شركة الراية»), as in the approved screens.

## Screens

| # | File | Screen | Covers |
|---|---|---|---|
| 1 | `Entry.dc.html` | Users list with «استيراد من ملف» | (a) entry point, who sees it; banner for a running import; banner and new status «لم تُرسل الدعوة» after an import without invitations |
| 2 | `Upload.dc.html` | Step 1 · الملف | (b) template download (XLSX/CSV, Arabic or English headers); (c) upload with type/size/row limits; recent imports in the organization |
| 3 | `TemplateGuide.dc.html` | Template columns (dialog) | (b) every column with Arabic and English header, required/optional, description in both languages, example |
| 4 | `UploadStates.dc.html` | Step 1 states | (c) uploading → **checking for viruses** → reading → ready |
| 5 | `Mapping.dc.html` | Step 2 · مطابقة الأعمدة | (d) auto-detected Arabic/English headers, one suggestion to confirm, columns that are never imported |
| 6 | `Review.dc.html` | Step 3 · المراجعة | (e) dry run: counts, grouped errors and warnings, row-level messages, existing users, skipped rows |
| 7 | `Options.dc.html` | Step 4 · الخيارات | (f) existing users (skip / add and update / update only), default role, send invitations now or later |
| 8 | `Confirm.dc.html` | Step 5 · التأكيد | (g) what will happen, in counts; roles to be given; start |
| 9 | `Progress.dc.html` | Import running | (h) background job with phases; safe to leave the page; stop |
| 10 | `Result.dc.html` | Import finished | (i) added, invited, updated, skipped, not imported; error report; next steps; undo |
| 11 | `ErrorReport.dc.html` | Error report (CSV) | (i) what the downloaded CSV looks like in Excel |
| 12 | `Undo.dc.html` | Undo an import (dialog) | BRD §10.4 rollback, as proposed in open question 10 |
| 13 | `States.dc.html` | Other states | (j) empty, file errors (type, size, rows, virus, encoding, empty, protected, upload cut), mapping/review errors, another import running, stop dialog, system fault, no permission, someone else's report, report deleted, HR Manager differences |

## 1. Purpose and flow

HR teams and new organizations need to add hundreds or thousands of employees at once instead of inviting them one by one. The wizard takes a CSV or Excel file, checks every row **before** anything is saved, lets the person fix the file or go on, and then adds the people in the background and sends their invitations.

1. **Users list → «استيراد من ملف».**
2. **الملف:** optional template download; upload; virus scan; the file is read.
3. **مطابقة الأعمدة:** file columns matched to our fields (automatic for known Arabic and English headers).
4. **المراجعة (dry run):** every row checked; nothing saved yet; the list of problems can be downloaded.
5. **الخيارات:** what to do with people who already exist, default role, invitations now or later.
6. **التأكيد:** counts of what will happen; start.
7. **Background import** with progress; the person may leave the page and gets a notification.
8. **النتيجة:** counts, error report (CSV), next steps, undo within 7 days.

## 2. Who can import

| Role | Sees «استيراد من ملف» | Rules |
|---|---|---|
| Organization Admin (مدير المنشأة) | Yes | Imports people with **non-privileged roles** only (see §6). Gives privileged roles afterwards from each user's profile, as today |
| HR Manager (مدير الموارد البشرية) | Yes | Same rules. Also, as in «تعديل البيانات» today, an HR import never changes the data of a member who holds a privileged role (those rows are skipped) |
| Everyone else | No | No button and no import banner; a direct link shows «ليست لديك صلاحية لاستيراد المستخدمين» |

The import never lets anyone do more than they could do one user at a time, and in some ways it does less (no privileged roles, no role changes for existing users, no reactivation or deactivation).

## 3. Template columns

The first row holds the headers, in Arabic or English; column order does not matter; optional columns can be left out. Files from other HR systems can be used without the template (the mapping step handles them).

| Column (AR / EN header) | Required | Format and rules |
|---|---|---|
| البريد الإلكتروني للعمل / Work email | **Yes** | Becomes the sign-in name; unique in the organization; **the key used to recognize existing users** (§5) |
| الاسم الأول / First name (Arabic) | **Yes** | Arabic, ≤ 60 characters (same rule as the invite form) |
| اسم الأب، اسم الجد / Father's, Grandfather's name (Arabic) | No | Arabic, ≤ 60 characters each |
| اسم العائلة / Family name (Arabic) | **Yes** | Arabic, ≤ 60 characters |
| الاسم الأول … اسم العائلة بالإنجليزية (4 columns) / names in English | No | Latin letters, ≤ 60 characters each |
| رقم الجوال / Mobile | No | With country code (E.164), e.g. `+966 55 123 4567`; Arabic digits, spaces and dashes accepted |
| الرقم الوظيفي / Employee number | No | Unique in the organization; letters and digits, ≤ 40 characters |
| المسمى الوظيفي (بالعربية / بالإنجليزية) / Job title (Arabic / English) | No | ≤ 150 characters each |
| القسم / Department | No | Name or code exactly as in «بيانات المنشأة»; the import does not create departments |
| الفرع / Branch | No | Name or code as in «بيانات المنشأة» |
| بريد المدير المباشر / Direct manager's email | No | Work e-mail of an active user **or of a person in the same file** |
| تاريخ التعيين / Hire date | No | Gregorian `YYYY-MM-DD` (Excel date cells are read as dates) |
| الدور الأساسي / Primary role | No | Role name in Arabic or English as on the «القوائم» sheet; empty → the default role chosen in step 4; privileged roles refused |
| أدوار إضافية / Additional roles | No | One or more role names separated by commas («،» or «,») |
| اللغة المفضلة / Preferred language | No | «العربية» / «English» (also `ar` / `en`); sets the interface language and the invitation's first language; empty → the organization's language |

- **XLSX template:** sheet «المستخدمون» (headers + drop-down lists for department, branch, roles, language), sheet «تعليمات» (the column guide), sheet «القوائم» (this organization's departments, branches and the roles the downloader may give). **CSV template:** header row only, UTF-8 with BOM. No example rows, so they cannot be imported by mistake.
- **Never imported from a file:** account status, passwords, privileged roles, and restricted personal data (gender, date of birth, national ID — FR-IAM-02; no national IDs in R1, TM-0004 F-PEO-05). Such columns are shown as «لا يُستورد» in step 2 and their values are not read or stored.
- **Header recognition:** known Arabic and English headers and common synonyms (e.g. «الإدارة» → القسم, «رقم الموظف» / "Employee ID" → الرقم الوظيفي, «الإيميل» / "E-mail" → البريد الإلكتروني للعمل), ignoring letter case, spaces, diacritics and Arabic letter variants (أ/ا، ة/ه، ى/ي). An unknown header whose values clearly look like e-mails, dates or phone numbers gets a **suggestion that must be confirmed**. Two columns cannot map to the same field.

## 4. Limits

| Limit | Proposal | Note |
|---|---|---|
| Rows per file | **5,000** | **PO decision** (open question 1). BRD FR-IAM-04 says up to 10,000 |
| File size | 20 MB | ADR 0006 `imports` bucket limit; 5,000 rows are about 1–3 MB |
| File types | `.xlsx`, `.csv` | Detected by content, not by the name. `.xls`, `.xlsm`, password-protected and macro files refused. XLSX: one sheet chosen in step 2 (the first by default); formulas read as their values |
| CSV encoding | UTF-8 (with or without BOM) | Other encodings refused with a clear message (TM-0004 T-PEO-09); comma or semicolon separators detected |
| Imports at a time | One per organization | TM-0003 T-IAM-34; others see «يجري استيراد آخر الآن» |
| Review kept | 24 hours | After that the unconfirmed file is deleted and must be uploaded again |

## 5. Matching and duplicates

- **Key:** the work e-mail, compared without letter case and surrounding spaces (dots and `+` tags are kept). Only this organization's people are checked; nothing is revealed about other organizations.
- **Same e-mail twice in the file:** **all** those rows are errors until the e-mail appears once — the system never picks one silently (TM-0003 T-IAM-20).
- **Same employee number twice in the file**, or **employee number already used by a different person:** error (it may point to the wrong person, TM-0004 T-PEO-10).
- **E-mail matches person A but the employee number belongs to person B:** error; neither is changed.
- **Matches an existing user** (active): step 4 decides — skip (default), or update their data.
- **Matches a person with a pending invitation, a deactivated account, or the importer themself:** skipped, with a reason. No reactivation and no deactivation by import (TM-0004 T-PEO-23).
- **Department and branch** are matched by code, or by name after the same Arabic normalization; a name used by two departments is reported (the code is needed).
- **Manager** may be another row of the same file; the import adds managers first. A row naming itself as manager, or rows forming a loop, are errors (TM-0004 AB-PEO-03).

## 6. What happens to each row

| Outcome | Meaning | Examples |
|---|---|---|
| **خطأ (error)** | The row is **not imported**; it goes to the error report | Missing/invalid required field, duplicates, key conflicts, unknown role, privileged role, Organization Admin role, manager loop, name too long |
| **تنبيه (warning)** | The row **is imported**; one optional value is left empty | Department/branch not found, manager not found or inactive, mobile without country code, unreadable hire date, unknown language (→ organization's language) |
| **يُتخطى (skipped)** | Deliberately not changed | Existing user when «تخطيهم» is chosen, pending invitation, deactivated account, the importer's own row, privileged member in an HR Manager's update |
| Info | Shown in the review only | Empty primary role → default role; a repeated additional role is ignored |

**Roles and BR-IAM-4.** One primary role and optional additional roles per row (BR-IAM-1). Only **non-privileged** roles can be given by import: «مدير المنشأة»، «مدير الموارد البشرية»، «المدير المالي»، «مسؤول الامتثال»، «المدقق» are refused for every importer (open question 3) — they need an authenticator code (decision of 6 Oct 2026) and are few, so they are given one at a time from the profile. «مدير المنشأة» in a file is always refused with its own message, because it is a setup role held alone (BR-IAM-4). Roles of **existing** users are never changed by import (open question 5); a role column on an existing user's row is ignored with a warning, so an Organization Admin can never get a second role through a file.

### Message catalogue (row level)

Messages are full sentences in the content-style-guide pattern (what happened → what to do), never blaming. Codes appear in the error report for support. The build adds the remaining field-format messages from the invite and edit forms.

| Code | Kind | Arabic | English |
|---|---|---|---|
| `EMAIL_REQUIRED` | Error | البريد الإلكتروني للعمل فارغ، وهو مطلوب. | The work email is empty; it's required. |
| `EMAIL_INVALID` | Error | البريد الإلكتروني غير مكتمل. يتكون من اسم ثم @ ثم النطاق، مثل name@example.com. | The email address is incomplete. It looks like name@example.com. |
| `NAME_AR_REQUIRED` | Error | الاسم الأول بالعربية فارغ، وهو مطلوب. (وكذلك اسم العائلة) | The Arabic first name is empty; it's required. (Same for family name) |
| `NAME_TOO_LONG` | Error | اسم العائلة أطول من 60 حرفًا. | Family name is longer than 60 characters. |
| `EMAIL_DUPLICATE_IN_FILE` | Error | البريد نفسه مكرر في الصفين 14 و203. لا يُستورد أيٌّ منهما حتى يبقى صف واحد لهذا البريد. | The same email is in rows 14 and 203. Neither is imported until the email appears once. |
| `EMPLOYEE_NUMBER_DUPLICATE_IN_FILE` | Error | الرقم الوظيفي نفسه مكرر في الصفين 88 و91. | The same employee number is in rows 88 and 91. |
| `EMPLOYEE_NUMBER_TAKEN` | Error | الرقم الوظيفي EMP-1042 مسجّل لشخص آخر في المنشأة. | Employee number EMP-1042 belongs to someone else in the organization. |
| `KEY_CONFLICT` | Error | البريد مسجّل لشخص، والرقم الوظيفي مسجّل لشخص آخر. لا يتغير أيٌّ منهما حتى تتطابق البيانات. | The email belongs to one person and the employee number to another. Neither is changed until they match. |
| `ROLE_UNKNOWN` | Error | الدور «منسق» غير معروف. يمكنك كتابة اسم الدور كما في ورقة «القوائم» في القالب، مثل «منسق التدريب». | Role "منسق" isn't recognized. Write the role as on the Lists sheet, for example "Training Coordinator". |
| `ROLE_PRIVILEGED` | Error | «مدير الموارد البشرية» دور مميز، ولا يُسند بالاستيراد. يمكن إسناده من ملف المستخدم بعد إضافته. | "HR Manager" is a privileged role and can't be given by import. Give it from the user's profile after the import. |
| `ROLE_ORG_ADMIN` | Error | لا يُسند دور «مدير المنشأة» بالاستيراد. يُسند من ملف المستخدم، ويكون الدور الوحيد لصاحبه. | The Organization Admin role can't be given by import. It's given from the user's profile and is the person's only role. |
| `MANAGER_LOOP` | Error | هذا الصف والصف 518 يجعلان كلًّا من الشخصين مديرًا للآخر، فتنشأ حلقة في التسلسل الإداري. لا يُستورد أيٌّ منهما حتى تُصحَّح. | This row and row 518 make each person the other's manager, a loop in the reporting line. Neither is imported until it's fixed. |
| `MANAGER_SELF` | Error | لا يمكن أن يكون الشخص مديرًا لنفسه. | A person can't be their own manager. |
| `DEPARTMENT_NOT_FOUND` | Warning | القسم «التسويق الرقمي» غير موجود في بيانات المنشأة. يُضاف الشخص دون قسم، ويمكن تحديده لاحقًا. | Department "التسويق الرقمي" isn't in Organization data. The person is added without a department. |
| `DEPARTMENT_AMBIGUOUS` | Warning | يوجد قسمان باسم «المبيعات». يُضاف الشخص دون قسم؛ يمكنك كتابة رمز القسم بدلًا من اسمه. | Two departments are called "المبيعات". The person is added without a department; use the department code instead. |
| `BRANCH_NOT_FOUND` | Warning | الفرع «فرع الدمام» غير موجود في بيانات المنشأة. يُضاف الشخص دون فرع. | Branch "فرع الدمام" isn't in Organization data. The person is added without a branch. |
| `MANAGER_NOT_FOUND` | Warning | لا يوجد مستخدم نشط بالبريد y.alomari@alraya.example، ولا يرد في الملف. يُضاف الشخص دون مدير مباشر. | No active user has the email y.alomari@alraya.example and it isn't in the file. The person is added without a direct manager. |
| `MOBILE_NO_COUNTRY_CODE` | Warning | رقم الجوال 0551234567 بلا رمز الدولة، فيُضاف الشخص دون رقم جوال. يُكتب الرقم مثل ‎+966551234567‎. | Mobile 0551234567 has no country code, so the person is added without a mobile. Write it like +966551234567. |
| `HIRE_DATE_INVALID` | Warning | تاريخ التعيين غير مفهوم، فيُضاف الشخص دونه. يُكتب بالتاريخ الميلادي مثل 2024-03-03. | The hire date can't be read, so the person is added without it. Write it like 2024-03-03. |
| `LANGUAGE_UNKNOWN` | Warning | اللغة «فرنسي» غير متاحة، فتُستخدم لغة المنشأة. | Language "فرنسي" isn't available, so the organization's language is used. |
| `ROLES_IGNORED_EXISTING` | Warning | لا تتغير أدوار المستخدمين الموجودين بالاستيراد، فلم يُقرأ عمود الدور في هذا الصف. | Roles of existing users aren't changed by import; the role column was ignored for this row. |
| `EXISTING_SKIPPED` | Skipped | مستخدم موجود من قبل، واختير تخطي الموجودين. | Already a user; existing users were skipped. |
| `INVITATION_PENDING` | Skipped | لهذا الشخص دعوة لم تُقبل بعد، فلن يتغير. | This person has an invitation not accepted yet; nothing changes. |
| `MEMBER_DEACTIVATED` | Skipped | حساب هذا الشخص معطّل، فلن يتغير. يمكن إعادة تفعيله من ملفه. | This person's account is deactivated; nothing changes. It can be reactivated from the profile. |
| `OWN_ROW` | Skipped | هذه بياناتك أنت، ولا تتغير بالاستيراد. | This is your own record; imports don't change it. |
| `PRIVILEGED_MEMBER` | Skipped | لهذا الشخص دور مميز، فيغيّر بياناته مدير المنشأة من ملفه. | This person holds a privileged role; the Organization Admin changes their data from the profile. |

## 7. Options (step 4)

- **Existing users** (BRD modes create-only / upsert / update-only): «تخطيهم دون تغيير» (default) · «إضافة الجدد وتحديث بيانات الموجودين» · «تحديث بيانات الموجودين فقط». Update changes names, mobile, employee number, job titles, department, branch, manager and hire date. **An empty cell never clears a value.** E-mail, roles and account status never change by import. Each update is audited with the changed field names (as «تعديل البيانات» today).
- **Default primary role** for rows without one: a list of non-privileged roles, «متدرب» by default.
- **Invitations:** «إرسال الدعوات فور انتهاء الاستيراد» (default) or «الإضافة دون إرسال الدعوات الآن». Without invitations, people appear under «مدعو» with the new status «لم تُرسل الدعوة» and can be invited later, all or some; the 7-day validity starts when the invitation is sent.

## 8. Security and privacy rules

- **Separation of duties (BR-IAM-4):** «مدير المنشأة» is never given by import, and roles of existing users never change by import, so no file can make an Organization Admin hold another role.
- **Privileged roles:** never given by import (open question 3). Non-privileged role grants follow the same rules as the invitation form: only roles the importer may give, never to oneself (decisions of 5 Oct 2026).
- **HR limits:** an HR import skips members who hold privileged roles and never changes the importer's own record (TM-0003 T-IAM-18).
- **File scanning (ADR 0006, NFR-SEC-08):** direct upload to private storage with a signed upload link; real type checked by content; virus scan (ClamAV) **before** the file is read; an infected file is quarantined, never read, and the uploader and Organization Admin are told; if the scanner is unavailable the file waits (no fail-open).
- **Retention:** uploaded file and error report deleted **7 days** after the import ends; files never confirmed deleted after 24 hours; the import record (who, when, file name, options, counts — no row data) kept with the audit log (open question 8).
- **Error report:** downloadable only by the person who ran the import; each download audited; contains only what the uploaded file contained (minus ignored columns); every cell starting with `=`, `+`, `-`, `@`, tab or carriage return is written as text so Excel cannot run it as a formula (TM-0003 T-IAM-19, TM-0004 AB-PEO-04).
- **Audit (BR-IAM-3, FR-AUD-01):** proposed events — import started (file id, options, row counts), completed or stopped (counts), rolled back (counts, reason), error report downloaded; every person invited or updated is audited as today, linked to the import. Event names are fixed by the build.
- **No personal data in logs:** job logs and errors carry row numbers and codes only (TM-0004 T-PEO-20); notifications carry counts only.
- **Fresh check at import time:** every row is checked again when it is written; anything that changed since the review (e.g. the same person invited by hand) goes to the error report.
- **Text safety:** names are normalized and stripped of hidden direction-control characters, as in the forms (TM-0004 T-PEO-04).

## 9. Background processing

- The import runs as a worker job (ADR 0005) in batches of 500 rows with checkpoints, so a restart continues where it stopped. Target: 10,000 rows in ≤ 5 minutes (NFR-PERF-05), so 5,000 rows should finish in a few minutes.
- Phases shown: checking rows again → adding people and roles → preparing and sending invitations.
- The person can leave the page; progress also shows as a banner on the users list; at the end the importer gets a notification with the counts and a link to the result.
- **Stop:** ends after the current batch; people already added stay, without invitations (they can be invited from the list, or the whole import undone).
- **System fault:** retried automatically; if it still cannot finish, the result page shows what was added and the remaining rows are in the error report.

## 10. Invitations

- One invitation per new person, created by the same invitation service as the invite form (FR-IAM-03: 7 days, resend ≤ 3, revoke) and sent by **our notification service** in the organization's name and brand (FR-NTF-02, decision of 7 Oct 2026) — the approved invitation e-mail (screen 7), with the importer as the inviter, in the row's preferred language first (else the organization's).
- Thousands of e-mails are sent gradually within the e-mail provider's limits; the result page shows how many have gone out so far.

## 11. Partial success

**Proposal (open question 7):** valid rows are imported and rows with errors are not; the error report lists every row that was not imported, skipped or imported with a warning, with a reason. The review shows the exact counts before anything is saved, so the person can instead fix the file and upload it again. The alternative ("all or nothing") blocks a 5,000-row import for one bad e-mail.

## 12. Undo (rollback, BRD §10.4)

**Proposal (open question 10):** «التراجع عن هذا الاستيراد» on the result page for 7 days. It removes the people added by the import who have not accepted their invitation (their links stop working at once), keeps those who already accepted (they can be deactivated one by one), restores the previous values of users the import updated unless they were changed again since, and is audited with an optional reason. It cannot itself be undone.

## 13. Accessibility (WCAG 2.2 AA, Arabic and English)

- The stepper is an ordered list with `aria-current="step"` and done steps announced as «مكتملة»; on phones it becomes «الخطوة 3 من 5 · المراجعة». After moving between steps, focus goes to the step heading and the page title names the step.
- Upload is a real «اختيار ملف» button (keyboard and screen readers); drag and drop is an extra, never the only way.
- Upload, scan, reading and import progress use `role="progressbar"` with a text value; a single polite live region announces only phase changes and the final result, not every percentage.
- Every mapping select is labelled by its file column; every status uses an icon **and** a word («خطأ»، «تنبيه»), never colour alone; messages are complete sentences that make sense alone.
- Tables have captions and row headers (row number); long tables scroll inside their card; dialogs (stop, undo) are alert dialogs with «رجوع» returning focus.
- No time limits inside the wizard except the 24-hour review, stated in advance; nothing redirects by itself when the import finishes.
- Targets ≥ 44 px, colours from the checked tokens, Arabic numerals and Hijri rules as elsewhere; the CSV files are UTF-8 with BOM so Arabic shows correctly.

## 14. Phone

The screens follow the approved ones: the layout stacks into one column at phone width, the stepper collapses to a line, tables scroll horizontally inside their card. Importing is mostly a desktop task (files live on computers), but uploading from a phone's files, following progress and downloading the report work.

## 15. Wording — new terms (glossary candidates)

Copy follows the glossary and style guide (verbal nouns on buttons, «يمكنك» + verbal noun, system "we", «رجوع» to leave a dialog, «إلغاء» only for cancelling the import itself). Terms the glossary does not have yet:

| English | Arabic used | Note |
|---|---|---|
| Import from file / import template | استيراد من ملف / قالب الاستيراد | «استيراد» is #135; «قالب» follows #34 |
| Column mapping | مطابقة الأعمدة | New |
| Review (dry run) | مراجعة البيانات | New; avoids «تجربة» / «محاكاة» |
| Error report | تقرير الأخطاء | New |
| Warning (row) | تنبيه | Follows #131 («تنبيه» for warnings) |
| Skip / skipped | تخطٍّ / يُتخطى، تُخطّي | New |
| Virus scan / malware | الفحص من الفيروسات / برنامج ضار | New |
| Invitation not sent (status) | لم تُرسل الدعوة | New status value for #146 |
| Default role | الدور الافتراضي | New |
| Privileged role / non-privileged roles | دور مميز / الأدوار غير المميزة | «دور مميز» is already in the product (T-M2-14) but not in the glossary |
| Existing users | الموجودون من قبل | New |
| Undo an import / stop an import | التراجع عن الاستيراد / إيقاف الاستيراد | «تراجع» follows #139 |
| Row / column / sheet | صف / عمود / ورقة | Spreadsheet terms |

## 16. Open questions for the PO

Each has a recommendation; the screens show the recommended answer.

1. **Maximum rows per file.** The BRD says 10,000; the screens show 5,000. **Recommendation: 5,000 per file in R1.** Reviews and error reports stay easy to read and thousands of invitation e-mails go out in a reasonable time; larger organizations split the file (e.g. by branch). It is one setting, so it can be raised after we measure real imports. (Choosing 5,000 means a small BRD change.)
2. **Who may import.** **Recommendation: Organization Admin and HR Manager**, with the same rules as inviting one person.
3. **Privileged roles in a file** (Organization Admin, HR Manager, Finance Manager, Compliance Officer, Auditor). **Recommendation: never by import, for anyone;** give them from the user's profile after the import. One wrong cell could otherwise give hundreds of people access to sensitive data, and these roles need an authenticator code.
4. **People who already exist.** **Recommendation: skip them by default,** and offer "add new and update existing" and "update existing only" (the three BRD modes).
5. **Roles of existing users.** **Recommendation: an import never changes roles of people who already exist** (only their personal and job data); roles are changed on the profile. This also keeps the Organization Admin alone in their role.
6. **Invitations.** **Recommendation: send them as soon as the import finishes by default,** with the option to add people now and invite later.
7. **Partial success.** **Recommendation: yes** — good rows go in, bad rows go to the error report with a reason, after the review has shown the exact counts.
8. **How long we keep the uploaded file and the error report.** **Recommendation: 7 days after the import, then deleted automatically;** files never confirmed are deleted after 24 hours. Shorter keeps less personal data; 7 days leaves time to fix errors and to undo.
9. **What the error report contains.** **Recommendation: the failed, skipped and warned rows with their values and a reason,** so HR can correct the report itself and upload it again; only the person who ran the import can download it. The alternative (row numbers and reasons only) is safer but means fixing the original file by hand.
10. **Undo an import.** **Recommendation: yes, within 7 days,** for people who have not accepted their invitation yet; people who already accepted stay. The BRD asks for import rollback (§10.4).
11. **Deactivated people in the file.** **Recommendation: skip them;** they are reactivated from their profile (an import never reactivates or deactivates anyone).
12. **Unknown department, branch or manager.** **Recommendation: import the person and leave that value empty (warning), and never create departments or branches from the file;** the review shows these rows first so they can be fixed before importing.
13. **E-mail volume.** Before a customer imports thousands of people, the e-mail provider plan (Resend) must allow that many messages per day and month. **Recommendation: check the plan before the first large customer import** (cost item; Claude prepares the numbers).

## 17. Notes for the build (Tech Lead)

- **BRD/threat-model alignment** once the PO answers: FR-IAM-04 says 10,000 rows (also NFR-PERF-05, TM-0003, TM-0004, ASVS mapping) — update with question 1. TM-0003 T-IAM-20 proposed no role column in R1; this design allows non-privileged roles for **new** people only, through the invitation guards (T-M2-07, T-M2-16: grant only what the actor may give, never to oneself, Organization Admin never combined), matching TM-0004 T-PEO-28 / SR-X-01 — update T-IAM-20 if accepted. ADR 0006 sets 30 days for the `imports` bucket; TM-0004 T-PEO-21 proposes ≤ 7 days for the source file and 24 hours for error reports, and TM-0003 T-IAM-30 says reports hold codes, not whole rows — questions 8 and 9 settle both.
- **Match key:** e-mail only in R1 (threat models suggest an explicit choice of e-mail or employee number); employee-number conflicts are errors. Employee number as a key fits the R2 HR sync (FR-INT-01).
- **«لم تُرسل الدعوة»:** invitations created without sending, with expiry starting at send time — an extension of T-M2-07's invitation model; «إرسال الدعوات (N)» on the list sends a batch.
- **Notification on completion** needs the in-app inbox (ADR 0008, not built yet); until then the users-list banner and the result page carry the outcome.
- **Staging:** the worker runs about every 5 minutes there (and GitHub may delay it), so staging imports wait for the next pass; production needs the worker host (pending PO cost decision).
- **Scanning on hosted staging** needs ClamAV next to the worker; it exists only in the self-hosted stack today (ADR 0006) — plan it with the file-storage work (also needed by T-M2-15b profile photos).
- **Manager depth:** T-M2-02 note — the manager-depth check scans the moved person's reports under a per-tenant lock; batch writes should take it once per batch.
- **Header synonyms** and Arabic normalization reuse `private.search_key` rules (hamza, teh marbuta, alef maqsura, diacritics).
