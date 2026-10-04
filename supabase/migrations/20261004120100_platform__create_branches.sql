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
  -- Names need at least one visible character (not only spaces, tabs, line breaks or invisible marks).
  constraint branches_name_ar_check check (
    char_length(name_ar) <= 200 and name_ar ~ '[^[:space:] ​-‏  ⁠﻿]'),
  constraint branches_name_en_check check (name_en is null or (
    char_length(name_en) <= 200 and name_en ~ '[^[:space:] ​-‏  ⁠﻿]')),
  constraint branches_city_check check (char_length(city_ar) <= 120 and char_length(city_en) <= 120),
  constraint branches_country_code_check check (country_code is null or country_code ~ '^[A-Z]{2}$'),
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

-- The timezone must be one PostgreSQL knows (IANA name); checked in a trigger because the catalog
-- view is not usable in a CHECK constraint.
create or replace function private.check_branch_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'unknown time zone "%"', new.timezone using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function private.check_branch_timezone() from public;

-- Triggers fire in name order: *_soft_delete normalises deleted_* before *_tree reads them.
create trigger branches_soft_delete before insert or update on platform.branches
  for each row execute function private.stamp_soft_delete();
create trigger branches_stamp_row before insert or update on platform.branches
  for each row execute function private.stamp_row();
create trigger branches_timezone before insert or update of timezone on platform.branches
  for each row execute function private.check_branch_timezone();
create trigger branches_tree before insert or update of parent_branch_id, deleted_at on platform.branches
  for each row execute function private.check_tree('parent_branch_id', '10');

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

-- [sd]: no DELETE grant; "delete" sets deleted_at (the trigger records when and by whom).
revoke all on platform.branches from public, anon;
grant select, insert, update on platform.branches to authenticated;
