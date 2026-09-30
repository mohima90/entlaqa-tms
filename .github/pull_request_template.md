## What & why
<!-- Summary. Link backlog task (docs/delivery/BACKLOG.md) and BRD IDs (e.g., FR-SCH-05). -->

## How tested
- [ ] Unit / integration tests
- [ ] E2E (Arabic + English) where UI changed
- [ ] RLS / tenant-isolation tests for new tables/endpoints
- [ ] Authorization negative tests

## Checklist
- [ ] Input validation at boundaries; no secrets / PII in logs
- [ ] Audit events for create/update/delete/sensitive reads
- [ ] RTL/LTR checked; Hijri/Gregorian where relevant
- [ ] Accessibility: no serious/critical violations
- [ ] Migrations reversible and reviewed
- [ ] API changes documented; no breaking changes
- [ ] Feature flag if incomplete/risky
- [ ] Separate code review pass completed; findings fixed or accepted
- [ ] Security-relevant? Separate security review completed and findings resolved
- [ ] `docs/delivery/STATUS.md` and `docs/delivery/BACKLOG.md` updated

## Screenshots (Arabic and English)
