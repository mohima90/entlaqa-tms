# Business flow — Custom fields

| | |
|---|---|
| **Epic** | WP-ADM-07 (Organization Admin) |
| **Requirements** | FR-ADM-11 (custom fields builder), FR-IAM-01 (custom fields on a person's profile) |
| **Status** | **On hold until the whole product is built (PO, 24 Oct 2026)** — drafted, not discussed |
| **Reference** | Kawadir ATS has no custom fields (checked in its code, 24 Oct 2026), so this flow follows the BRD. The screens will come from Mobbin after this flow is agreed |

## 1. Goal
Every organization records some information the product does not have out of the box: a person's cost center or shirt size, a course's internal code or accreditation body. The Organization Admin adds these as **custom fields**. They then appear on the forms and pages of that kind of record, can be filled in bulk through the import, and can be used to filter lists. No help from ENTLAQA is needed.

## 2. Actors and roles
| Actor | Role | What they do in this flow |
|---|---|---|
| Organization Admin | Standard role | Creates, edits, orders, archives and restores custom fields; decides who sees each one |
| HR Manager (and the Organization Admin) | Standard roles | Fill a person's custom fields when they add or edit a person, or in the bulk import |
| L&D Manager | Standard role | Fills a course's custom fields when adding or editing a course |
| Everyone else | Any role | Sees a custom field only where the Organization Admin allowed it (§4 BR-CF-4) |

## 3. Step-by-step flow

**A. Creating a field (Organization Admin)**
1. The Organization Admin opens **Settings → Custom fields** and picks the kind of record: **People** or **Courses** in release 1. More kinds are added when each is built (sessions, enrollments, instructors, vendors, venues — §9 Q1).
2. They click **Add field** and fill in:
   - the label in Arabic and in English, with an optional short hint shown under the field;
   - the **type** (list below);
   - for a choice list: its options, each in Arabic and English;
   - whether it is **required**;
   - **who sees it**: everyone who can see the record, or only some roles.
3. The field appears at once on that kind of record's form and page, in the order the Organization Admin set (drag to reorder).

**Field types:**

| Type | Example |
|---|---|
| Text | Cost center name |
| Number | Years of experience |
| Date | Contract end date |
| One choice from a list | Shirt size: S / M / L |
| Several choices from a list | Languages spoken |
| Yes / No | Has a company car |
| A person in the organization | HR business partner |
| File | Signed agreement (PDF) |

**B. Filling a field**
1. Whoever can edit the record (person or course) fills its custom fields on the same form as the built-in fields. A required field must be filled before saving.
2. The **bulk import** of people has one column per custom field. The downloadable template includes them, and wrong values are reported on their row, like the other columns.
3. A custom field's value is shown on the record's page, under its own heading «Additional information».

**C. Using a field**
1. List pages (people, courses) can be **filtered** by a «one choice», «several choices», «yes / no» or «date» custom field.
2. Reports and the API come with those features later (FR-RPT, FR-LMS), and custom fields are included then.

**D. Changing or removing a field**
1. Labels, hint, options, required and who sees it can be changed at any time.
2. The type cannot be changed once any record has a value (create a new field instead).
3. **Archive** instead of delete: an archived field disappears from forms, pages and filters. Its values are kept and come back if the field is **restored**. An unused field can be deleted for good.
4. A list option is also archived, not deleted: records that already have it keep it, and nobody can pick it again.
5. Every change to a field, and every change to a value, is recorded in the audit trail with who, when, before and after.

## 4. Business rules
- BR-CF-1: only the Organization Admin creates and changes custom fields.
- BR-CF-2: at most **30 active fields** per kind of record (proposal — §9 Q3).
- BR-CF-3: making a field required later does not block existing records. They show «missing» and must be completed at their next save.
- BR-CF-4: a field limited to some roles is **never sent** to anyone else, not just hidden on screen. The person themselves sees their own person fields only if the field is marked «visible to the person».
- BR-CF-5: custom fields must not collect national ID or Iqama numbers, bank details or health information. The hint on the «Add field» screen says so (security decision 6, PDPL); the product cannot check the meaning of a label.
- BR-CF-6: a «file» field follows the normal file rules: type and size limits, virus scan, and it counts towards the plan's storage limit.
- BR-CF-7: a «person» field can only point to a person in the same organization.

## 5. Decisions and approvals
| Decision / approval | Who decides | When | What happens |
|---|---|---|---|
| Add, change, archive, restore a field | Organization Admin | Any time | Takes effect at once; audited |
| Custom fields included in a plan | Super Admin (plan editor) | When creating plans | Proposal — §9 Q2 |

## 6. Exceptions
- The limit of 30 is reached → «Add field» is refused with a message; archive a field first.
- A bulk-import row has a wrong value (unknown option, bad date, missing required) → that row is reported with the column; the other rows go on.
- A «person» field points to someone who is later deactivated → the value stays and shows the name with «(deactivated)».
- A list option is archived while records use it → the records keep it; it shows with «(archived)».

## 7. Inputs and outputs
| Input (from where) | Output (to where) |
|---|---|
| Field definitions (Organization Admin, Settings → Custom fields) | The forms, pages, filters and import template of people and courses |
| Values (forms, bulk import) | The record's page; filters; later reports, API and the LMS mapping (FR-LMS-10) |

## 8. Screens this implies
| # | Screen | Role | Main actions |
|---|---|---|---|
| 1 | Settings → Custom fields: a tab per kind of record, the list of fields (drag to order, archived shown apart) | Organization Admin | Add, edit, reorder, archive, restore, delete unused |
| 2 | Add / edit field (side panel) | Organization Admin | Labels AR/EN, hint, type, options, required, who sees it |
| 3 | Person and course forms + pages: «Additional information» section | HR Manager, L&D Manager, Organization Admin | Fill, see |
| 4 | People and course lists: custom-field filters | Whoever sees the list | Filter |
| 5 | Bulk import template and results: custom-field columns | HR Manager, Organization Admin | Import |

## 9. Open questions
| # | Question | Proposed answer | PO answer |
|---|---|---|---|
| Q1 | Start with **People and Courses** (they exist today), and add sessions, enrollments, instructors, vendors and venues when each is built? | **Yes** — the same screen gets a new tab with each one | |
| Q2 | Is «Custom fields» a feature the Super Admin includes in a plan (like bulk import)? | **Yes** — add it to the plan's feature list | |
| Q3 | Limit of active fields per kind of record? | **30** | |
