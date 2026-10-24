-- A branch's address, location and working week (WP-HR-01; FR-ADM-04 address, GPS, working week with half-days
-- and working hours; BR-ADM-3; business flow docs/business-flows/EP-ORG-structure-completion.md §3 E, agreed by
-- the PO 24 Oct 2026: the location is typed in, no map). Class: T [std]. PII: none (an office's address).
--
--   platform.branches.address_en / address_ar   the branch's address (each optional, ≤ 300 characters)
--   platform.branches.latitude / longitude      decimal degrees, typed in; both or neither (used later for
--                                               check-in near the branch)
--   platform.branch_working_days                the branch's OWN working week: one row per working day (0 = Sunday …
--                                               6 = Saturday, as tenant_settings.working_days), with its hours in
--                                               whole minutes, start before end, no work across midnight; a
--                                               half-day is a day with shorter hours. No rows = «Same as the
--                                               organization» (Settings → General, tenant_settings). Where the
--                                               product needs a working week it uses the branch's own, else the
--                                               organization's (BR-ADM-3; legal entities R3).
-- Writes: platform.org.manage organization-wide (the HR Manager), as the branch itself (20261020210000).
-- Audit: the branch-changed audit of the actions carries before / after of all of it.
-- Expand-first: the running application writes none of the new columns or rows.

alter table platform.branches
  add column address_en text,
  add column address_ar text,
  add column latitude numeric(9, 6),
  add column longitude numeric(9, 6),
  add constraint branches_address_check check (
    (address_en is null or (char_length(address_en) <= 300 and private.has_visible_text(address_en)))
    and (address_ar is null or (char_length(address_ar) <= 300 and private.has_visible_text(address_ar)))),
  add constraint branches_location_check check (
    num_nonnulls(latitude, longitude) in (0, 2)
    and (latitude is null or latitude between -90 and 90)
    and (longitude is null or longitude between -180 and 180));
comment on column platform.branches.latitude is 'Decimal degrees, typed in by HR (WP-HR-01); with longitude, or neither.';

create table platform.branch_working_days (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  branch_id uuid not null,
  day smallint not null,
  starts_at time not null,
  ends_at time not null,
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, branch_id, day),
  constraint branch_working_days_day_check check (day between 0 and 6),
  constraint branch_working_days_hours_check check (
    ends_at > starts_at and extract(second from starts_at) = 0 and extract(second from ends_at) = 0),
  foreign key (tenant_id, branch_id) references platform.branches (tenant_id, id)
);
comment on table platform.branch_working_days is
  'A branch''s own working week, one row per working day; none = the organization''s week (FR-ADM-04, BR-ADM-3; WP-HR-01). Owner: platform. Class: T [std].';

create trigger branch_working_days_stamp_row before insert or update on platform.branch_working_days
  for each row execute function private.stamp_row();

alter table platform.branch_working_days enable row level security;
alter table platform.branch_working_days force row level security;

create policy tenant_isolation on platform.branch_working_days
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Every member reads them (scheduling, reminders and the branch page use them).
create policy branch_working_days_read on platform.branch_working_days for select to authenticated using (true);
create policy branch_working_days_insert on platform.branch_working_days for insert to authenticated
  with check (private.actor_may_manage_structure(tenant_id));
create policy branch_working_days_update on platform.branch_working_days for update to authenticated
  using (private.actor_may_manage_structure(tenant_id))
  with check (private.actor_may_manage_structure(tenant_id));
create policy branch_working_days_delete on platform.branch_working_days for delete to authenticated
  using (private.actor_may_manage_structure(tenant_id));

revoke all on platform.branch_working_days from public, anon;
grant select, delete on platform.branch_working_days to authenticated;
grant insert (branch_id, day, starts_at, ends_at) on platform.branch_working_days to authenticated;
grant update (starts_at, ends_at) on platform.branch_working_days to authenticated;
