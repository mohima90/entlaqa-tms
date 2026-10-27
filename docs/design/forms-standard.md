# Forms standard — the Kawadir pattern

Agreed with the PO on 27 Oct 2026 as part of the clean-up pass (WP-FIX-02, `docs/delivery/test-feedback-2026-10-27.md` #5, #12). The PO's words: «Kawadir is super organized: enter a department, then it asks for the next level if you wish; the conditions are perfect there.» Every «Add» and «Edit» form in Jadarat TMS follows these rules; nobody approves a form screen by screen.

## The rules

| # | Rule | What it means on the screen |
|---|---|---|
| 1 | **One form = one thing, with the fewest fields** | Creating asks only what the person must know now (for a department: the English and Arabic names). Everything the system can work out is worked out (the code, the parent's branch). The rest waits behind **«More»** or until the thing exists. |
| 2 | **One field per row** | No two fields side by side, in a dialog or a panel. Reading top to bottom, in Arabic and English alike. |
| 3 | **The next step is offered after saving** | «Sector added. Add a Department under it?» — buttons «Add a Department under it», «Add another Sector», «Done». The person never looks for the next form. |
| 4 | **A wide, full-height panel** | Side panels 560 px (720 px for wide content); dialogs up to 560 px; no small pop-ups for forms. |
| 5 | **Rules only when they apply, in plain words** | A hint appears next to the field it concerns, and a refusal says what to change («Another department has this code»), never the rule book up front. |
| 6 | **Long lists can be searched** | A list of more than about twenty choices (countries, people) is a searchable field: type to filter, arrow keys, Enter. |
| 7 | **Defaults from the context** | A department under a Sector takes the Sector's branch; a cost centre starts active; the language of the page is the first name asked. |

## The example: Add Department (`apps/suite/src/components/structure/unit-panel.tsx`)

1. Fields: **English name**, **Arabic name** (one is enough). «More» opens the code (suggested from the English name, editable), the branch (the parent's by default), the head and the cost centre.
2. Save → «Marketing added.» with **Add a Section under it** · **Add another Department** · **Done**.
3. The refused field, if it was behind «More», opens «More» and shows its message.

## Where it is applied (27 Oct 2026)

Departments (add, with the follow-up), cost centres (names first, code after, Active only when editing), branches, people (invite, edit, personal details), courses, planning cycle basics, roles, the Super Admin's organization, plan and e-mail forms, needs-form inspectors, invitation acceptance: one field per row everywhere; the country is a searchable list.

## Still to do

- «More» on the other long forms (invite a person, add a course) once their flows are revisited with the PO.
- The next-step offer on branches and cost centres («Add another?») if the PO asks for it.
