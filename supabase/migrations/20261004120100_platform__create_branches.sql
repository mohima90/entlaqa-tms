-- Branches of an organization (الفروع). Features: ADM-04 (subset needed by users & roles, T-M2-01);
-- GPS, working calendar and prayer-time overrides are added with EP-M2-TEN. ADR 0002 §6 pattern.
-- Class: T [std][sd]. PII: none.

create table platform.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  code text not null,
  name_ar text not null,
  name_en text,
  parent_branch_id uuid,
  country_code char(2),
  city_ar text,
  city_en text,
  timezone text not null default 'Asia/Riyadh',
  is_headquarters boolean not null default false,
  status text not null default 'active',
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  -- [sd]
  deleted_at timestamptz,
  deleted_by uuid,
  unique (tenant_id, id),
  constraint branches_code_check check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  constraint branches_name_ar_check check (length(btrim(name_ar)) between 1 and 200),
  constraint branches_name_en_check check (name_en is null or length(btrim(name_en)) between 1 and 200),
  constraint branches_country_code_check check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint branches_timezone_check check (timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){0,2}$'),
  constraint branches_status_check check (status in ('active', 'inactive')),
  constraint branches_parent_check check (parent_branch_id is distinct from id),
  constraint branches_deleted_check check (deleted_by is null or deleted_at is not null),
  foreign key (tenant_id, parent_branch_id) references platform.branches (tenant_id, id)
);
comment on table platform.branches is 'Branches of an organization (ADM-04). Owner: platform. Class: T [std][sd].';

create unique index branches_tenant_code_uq on platform.branches (tenant_id, lower(code)) where deleted_at is null;
create unique index branches_tenant_headquarters_uq on platform.branches (tenant_id)
  where is_headquarters and deleted_at is null;
create index branches_tenant_parent_idx on platform.branches (tenant_id, parent_branch_id)
  where parent_branch_id is not null;

create trigger branches_stamp_row before insert or update on platform.branches
  for each row execute function private.stamp_row();

alter table platform.branches enable row level security;
alter table platform.branches force row level security;

create policy tenant_isolation on platform.branches
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Fine-grained permissions (platform.org.*) are enforced server-side by defineAction (ADR 0003 §4).
create policy branches_read on platform.branches for select to authenticated using (true);
create policy branches_insert on platform.branches for insert to authenticated with check (true);
create policy branches_update on platform.branches for update to authenticated using (true) with check (true);

-- [sd]: no DELETE grant; "delete" sets deleted_at / deleted_by.
revoke all on platform.branches from public, anon;
grant select, insert, update on platform.branches to authenticated;
