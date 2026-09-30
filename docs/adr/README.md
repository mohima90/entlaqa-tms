# Architecture Decision Records (ADRs)

Each significant technical decision is recorded here using the template in Development Plan Appendix E. ADRs are immutable once **Accepted**; a later ADR may **supersede** an earlier one.

| # | Title | Status | Backlog |
|---|---|---|---|
| [0001](0001-monorepo-and-module-boundaries.md) | Monorepo layout and module boundaries | Proposed | T-M1-B01 |
| [0002](0002-tenancy-and-row-level-security.md) | Multi-tenancy, tenant resolution and row-level security | Proposed | T-M1-B02 |
| [0003](0003-authentication-and-authorization.md) | Authentication, authorization, permissions and data scopes | Proposed | T-M1-B03 |
| 0004 | Domain events: transactional outbox and PostgreSQL queue | Planned | T-M1-B04 |
| 0005 | Background jobs and scheduling (self-hostable) | Planned | T-M1-B05 |
| 0006 | File storage, signed URLs and malware scanning | Planned | T-M1-B06 |
| 0007 | i18n/RTL, Hijri and working calendars, prayer times | Planned | T-M1-B07 |
| 0008 | Notification service abstraction | Planned | T-M1-B08 |
| 0009 | Observability | Planned | T-M1-B09 |
| 0010 | Sovereign (in-country) deployment approach | Planned | T-M1-B10 |
| 0011 | API style, versioning and error model | Planned | T-M1-B11 |
| 0012 | AI provider abstraction and governance | Planned | T-M1-B12 |

**Status values:** Proposed (awaiting PO approval via PR merge) · Accepted · Superseded by NNNN · Deprecated.

Merging an ADR's pull request by the Product Owner marks it **Accepted**; the next session updates the status column.
