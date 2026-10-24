# Plans, limits and the organization's status (WP-ADM-06)

Business flow: [`EP-PLAN`](../business-flows/EP-PLAN-plan-limits-feature-switches.md) (agreed 24 Oct 2026). Requirements: FR-ADM-13, FR-SUB-01, FR-ADM-17.

## What decides what

| Rule | Where it is enforced | Code |
|---|---|---|
| A feature with permissions (planning, needs forms, courses) is outside the plan | `private.member_permissions` leaves its permissions out (every guard and policy); the app's grant loader does the same (`platform-rbac` `grantsWithinPlan`) | — |
| A feature without a permission of its own (bulk import, own branding, own e-mail provider) | Triggers refuse a member's write (`private.enforce_plan_feature`); the e-mail routes ignore the organization's provider and colours; the app hides the menu entries and pages | JL003 |
| People limit | Trigger on invitations and memberships (`private.enforce_people_limit`): a new invitation, account or reactivation that adds a person over the limit | JL001 |
| Storage limit | Trigger on `platform.files` (`private.enforce_storage_limit`): a member's new file over the limit (the worker's own files, e.g. import reports, are not refused) | JL002 |
| Trial end | Worker platform task `platform.trial_expiry` (every 10 minutes) → `private.expire_trials()` | — |
| Suspended organization | Its Organization Admin's session is `paused` (`private.session_access`): `current_tenant_id()` stays null, only `private.organization_plan()` answers; everyone else gets «Access to this organization is paused.» from the access-token hook | — |

`defineAction` turns JL001–JL003 into `PLAN_PEOPLE_LIMIT`, `PLAN_STORAGE_LIMIT` and `PLAN_FEATURE_OFF` (`platform-rbac` `planRefusal`); a bulk-import row gets `PEOPLE_LIMIT`.

## Who reaches what

- Role `plan_guard` (NOLOGIN, NOINHERIT, no BYPASSRLS) owns every plan function and alone reaches `private.plans` and changes an organization's plan, status, trial and special limits (`verify-deployment.sql` checks it).
- The console functions (`platform_list_plans`, `platform_save_plan`, `platform_tenant_plans`, `platform_set_tenant_plan`) require a signed-in Super Admin (`private.platform_admin_caller`); every change is audited in the platform's trail, an organization's plan and status also in its own.
- `organization_plan()` requires `platform.tenant.manage` in the caller's organization, or the paused state.

## Counting

- People: active or invited memberships plus pending, unexpired invitations, each person once.
- Storage: files not deleted, rejected or infected, by their real size once known (abandoned uploads excluded); 1 GB = 1024³ bytes.
- An organization on no plan has every feature and no limits (the organizations that existed before WP-ADM-06).
