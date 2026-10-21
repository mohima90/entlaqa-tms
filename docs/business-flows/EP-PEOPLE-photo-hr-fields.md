# Business flow — Profile photo and HR-only person fields

| | |
|---|---|
| **Work package** | WP-ADM-04 (ROADMAP-by-role) · BACKLOG T-M2-51 (this flow), T-M2-15b (photo), T-M2-25 (fields) |
| **Requirements** | FR-IAM-16 (My profile: own photo) · FR-IAM-01 (photo, grade) · FR-IAM-02 (gender, date of birth, employment category — restricted to HR / Compliance) · FR-IAM-04 (import columns) · NFR-SEC-08 (uploads scanned, type-checked, private) · FR-AUD-01 |
| **Status** | **Draft — for PO review** (21 Oct 2026) |
| **Copied from Kawadir** | Kawadir ATS **My profile** (`/org/profile`): a round photo with **Upload photo** («JPG, PNG or GIF, max 2 MB»), shown in the header and on the Team members list; the person uploads their own photo only; there is no remove button. Files go to a public folder of the organization, any image type is accepted by its declared type (SVG and GIF included) and nothing is scanned. Kawadir has **no** gender / date of birth / category fields for staff (only for candidates); its **grades** are an HR-managed list (English/Arabic name, grade range) used on jobs. **We copy:** own photo on My profile, the 2 MB limit, where the photo shows. **We do not copy:** public files, SVG/GIF, type by declared name, no scanning; we add **Remove**. Gender, date of birth, category and grade come from the BRD, not Kawadir |

## 1. Goal
Everyone can put a face to a name: each person adds their own photo, seen wherever people are listed. HR records the four facts needed later for ESG and ministry reports — gender, date of birth, employment category and grade — and only HR (and roles given that permission) can see or change them.

## 2. Actors and roles
| Actor | Role | What they do in this flow |
|---|---|---|
| Any signed-in person | Any | Adds, replaces or removes **their own** photo on My profile; sees their own HR-only fields (read-only) |
| HR | HR Manager (standard) | Sees and edits HR-only fields for every member; fills them on the person page or by bulk import; may remove someone's unsuitable photo |
| Compliance / HR assistant | Custom role holding «View and edit HR-only fields» (proposed new permission, privileged) | Same as HR Manager for these fields |
| Organization's IT person | Organization Admin | May remove an unsuitable photo; does **not** see HR-only fields (question 1) |
| Everyone else | Any | Sees photos of the people they can see; never sees HR-only fields |

## 3. Step-by-step flow
**Photo**
1. **Person → header picture → My profile → Photo → Upload** → picks a PNG, JPG or WebP picture → the product shrinks it to profile size, removes hidden details (e.g. the GPS position) and checks it.
2. While it is being checked the person sees «Your photo is being checked» and everyone else still sees the initials; once clean (usually under a minute) the photo appears in the header, on the person page, Team members list and people pickers.
3. **Replace** works the same way (the old photo is deleted); **Remove** goes back to initials.
4. **HR Manager or Organization Admin → person page → Remove photo** (with a short reason) for an unsuitable photo → the person is told by e-mail and may upload another.

**HR-only fields**
5. **HR Manager → Team members → person → Edit details → «HR details»** section: gender (Male / Female), date of birth (Gregorian picker with the Hijri date shown), employment category (Management · Professional · Technical · Operational), grade (short text) → Save.
6. **Bulk import (HR Manager):** the same four columns can be mapped in the import wizard; for an importer without the HR permission they are not offered and the preview says they were skipped.
7. **The person → My profile** shows their own HR details read-only with «Ask HR to correct these».

## 4. Business rules
- BR-PPL-a **Own photo only:** nobody uploads a photo for someone else; HR Manager and Organization Admin may only remove one (reason required, audited, the person e-mailed).
- BR-PPL-b **Photo files:** PNG, JPG or WebP checked by their content (SVG and GIF refused); at most 2 MB after shrinking; hidden details removed; stored privately and shown only to signed-in members of the same organization; a replaced or removed photo is deleted.
- BR-PPL-c **Photos are virus-scanned** (unlike branding images, PO «B» 20 Oct 2026 — every other upload stays scanned): shown to others only once clean; an infected file is deleted and the person told «this file could not be used».
- BR-PPL-d **Who sees photos:** whoever can see the person in the product; a deactivated person's photo stays on old records but they no longer appear in pickers.
- BR-PPL-e **HR-only fields — who:** seen and edited only by the HR Manager and custom roles with «View and edit HR-only fields» (whole-organization scope); the person sees their own read-only; managers, Department Heads, L&D and the Organization Admin do not see them (FR-IAM-02 «restricted to HR/Compliance by default»).
- BR-PPL-f **HR-only fields grant no access**, so the HR Manager may fill them for **every** member, including privileged members (Organization Admin, other HR Managers) — an exception to today's rule that HR cannot edit a privileged member's record.
- BR-PPL-g **All optional:** no field is required; date of birth must be a real date in the past; the category list is fixed in R1 (own lists come with custom fields, WP-ADM-07).
- BR-PPL-h **Reports:** these fields leave the HR screens only as counts (e.g. «women in technical roles trained»), never as named lists, unless the viewer holds the HR permission.
- BR-PPL-i **Audit:** photo added / replaced / removed (file name only, never the picture); HR-only field changes recorded with the field names and **«value hidden»** (EP-AUD BR-AUD-f).
- BR-PPL-j **Arabic and English:** every label, list value and message in both; Hijri shown next to Gregorian dates; the photo's alternative text is the person's name in the reader's language.

## 5. Decisions and approvals
| Decision / approval | Who decides | When | What happens |
|---|---|---|---|
| Give «View and edit HR-only fields» to a custom role | Organization Admin (privileged permission) | Any time | Holders see the HR details section |
| Remove someone's photo | HR Manager / Organization Admin | When unsuitable | Photo deleted, person e-mailed, audited |
| Whether gender, date of birth, nationality are sensitive data | Legal counsel (security decision 13) | Before the first customer | May add consent or stricter rules |

## 6. Exceptions
- **Wrong type or too big** → refused with the reason before upload.
- **Photo still being checked** after several minutes (background checks delayed) → initials stay; the person may try again later; nothing is lost.
- **Infected photo** → deleted; the person is told; recorded in the audit log.
- **Import row with an impossible date of birth or unknown category** → that row's error report says which field, the rest of the row imports.
- **Person leaves** → fields and photo stay with the record while it is kept; erased with it under the retention / erasure rules (FR-AUD-03/04, later).

## 7. Inputs and outputs
| Input (from where) | Output (to where) |
|---|---|
| Photo file (the person, My profile) | Profile picture in header, person page, lists, pickers |
| HR details (HR Manager form or import file) | Stored HR-only fields → later ESG / ministry reports (counts) |
| — | Audit events (no values for HR-only fields) |

## 8. Screens this implies
| # | Screen | Role | Main actions |
|---|---|---|---|
| 1 | My profile → Photo (upload, replace, remove, «being checked») + read-only HR details | Any person | Upload, replace, remove |
| 2 | Person page → photo with **Remove photo** | HR Manager, Organization Admin | Remove with reason |
| 3 | Edit details → **HR details** section | HR Manager (+ permission holders) | Edit four fields |
| 4 | Import wizard → mapping and preview with the four columns | HR Manager | Map, see skipped columns |

## 9. Open questions
| # | Question | Proposed answer | PO answer |
|---|---|---|---|
| 1 | Does the **Organization Admin** see and edit HR-only fields? | **No** (FR-IAM-02: HR/Compliance only; the Organization Admin is a set-up role) | |
| 2 | Is **grade** HR-only too (FR-IAM-01 lists it with ordinary fields)? | **Yes**, HR-only — it hints at pay | |
| 3 | Grade as **short free text** now, or an HR-managed list like Kawadir's grades? | **Free text** in R1; a list with custom fields (WP-ADM-07) | |
| 4 | Employment category list | **Fixed four** (Management, Professional, Technical, Operational) in R1 | |
| 5 | Does the person see their **own** HR details (read-only)? | **Yes** (transparency; data-protection right of access) | |
| 6 | Profile photos **virus-scanned** (shown once clean), unlike branding images? | **Yes** — every employee can upload, a much wider door than one admin | |
| 7 | Size limit: Kawadir's **2 MB**, with big phone photos shrunk automatically before upload? | **Yes** | |
| 8 | May HR Manager / Organization Admin **remove** (never upload) someone's photo? | **Yes**, with a reason; the person is e-mailed | |
| 9 | May the HR Manager fill HR-only fields for privileged members (BR-PPL-f)? | **Yes** — the fields give no access | |
