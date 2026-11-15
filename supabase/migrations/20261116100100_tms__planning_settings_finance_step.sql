-- Planning settings → «Finance confirms the plan» (WP-LD-03, T-M3-07; FR-PLN-08; business flow
-- docs/business-flows/EP-PLN-planning-cycle.md §13 c, d: optional per organization, a switch in Planning settings, off
-- by default). Class: T [std] (a new column of tms.planning_settings). PII: none.
--
-- On: after the HR Manager approves, every holder of the ready-made Finance role is asked to confirm (migration
-- 20261116100200 reads the switch when the plan is submitted, so a plan already waiting keeps the steps it was
-- submitted with). Written by the L&D Manager like the rest of the settings (policies of 20261020150100); every
-- change is audited by the application (tms.planning_settings.changed with before / after).
-- Expand-first: a new column with a default; the previous release neither reads nor writes it.

alter table tms.planning_settings add column finance_confirms boolean not null default false;

comment on column tms.planning_settings.finance_confirms is
  'Finance confirms the training plan after the HR Manager approves it (EP-PLN §13 c, d; off by default).';

grant insert (finance_confirms) on tms.planning_settings to authenticated;
grant update (finance_confirms) on tms.planning_settings to authenticated;
