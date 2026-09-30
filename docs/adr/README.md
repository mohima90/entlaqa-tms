# Architecture Decision Records (ADRs)

Each significant technical decision is recorded here using the template in Development Plan Appendix E. ADRs are immutable once **Accepted**; a later ADR may **supersede** an earlier one.

| # | Title | Status | Backlog |
|---|---|---|---|
| [0001](0001-monorepo-and-module-boundaries.md) | Monorepo layout and module boundaries | Proposed | T-M1-B01 |
| [0002](0002-tenancy-and-row-level-security.md) | Multi-tenancy, tenant resolution and row-level security | Proposed (rev. 1) | T-M1-B02 |
| [0003](0003-authentication-and-authorization.md) | Authentication, authorization, permissions and data scopes | Proposed (rev. 1) | T-M1-B03 |
| [0004](0004-domain-events-outbox.md) | Domain events: transactional outbox and PostgreSQL queue | Proposed | T-M1-B04 |
| [0005](0005-background-jobs-and-scheduling.md) | Background jobs and scheduling (self-hostable) | Proposed | T-M1-B05 |
| [0006](0006-file-storage-and-scanning.md) | File storage, signed URLs and malware scanning | Proposed | T-M1-B06 |
| [0007](0007-i18n-rtl-calendars.md) | i18n/RTL, Hijri and working calendars, prayer times | Proposed | T-M1-B07 |
| [0008](0008-notification-service.md) | Notification service abstraction | Proposed | T-M1-B08 |
| [0009](0009-observability.md) | Observability | Proposed | T-M1-B09 |
| [0010](0010-sovereign-deployment.md) | Sovereign (in-country) deployment approach | Proposed | T-M1-B10 |
| [0011](0011-api-style-and-errors.md) | API style, versioning and error model | Proposed | T-M1-B11 |
| [0012](0012-ai-governance.md) | AI provider abstraction and governance | Draft | T-M1-B12 |

**Status values:** Proposed (awaiting PO approval via PR merge) · Accepted · Superseded by NNNN · Deprecated.

Also: [R1 data model](../architecture/r1-data-model.md) (T-M1-B13) · [migration conventions](../architecture/migration-conventions.md).

Merging an ADR's pull request by the Product Owner marks it **Accepted**; the next session updates the status column.
