-- Organization profile and regional settings (FR-ADM-02, FR-SCH-07, BR-ADM-3; T-M2-22; approved screen
-- «بيانات المنشأة» / "Organization profile", PO 14 Oct 2026). ADR 0002 §6 pattern. Class: T. PII: none.
--
--   platform.tenant_settings  one row per organization (data model §2.1), created with it (trigger on
--     platform.tenants; existing organizations: 20261017090100) and never deleted. The display names stay
--     in platform.tenants (name_ar / name_en, 20261017090200). What each setting is:
--       industry                 one of the fixed list of the screen (AR/EN labels in the app); null until set
--       country_code             ISO 3166-1 alpha-2; null until the Organization Admin sets it (provisioning
--                                does not ask for it — no country is guessed for existing organizations)
--       currency_code            ISO 4217 default currency (amounts keep their own currency, BR-ADM-2, DR-4)
--       timezone                 IANA time zone of the organization (dates and "today"); a branch may have
--                                its own (BR-ADM-3: branch → legal entity → organization → country default)
--       fiscal_year_start_month  1–12 (training plans and budgets)
--       default_locale           ar / en: language of new people (invitations, bulk import) unless one is
--                                given; each person changes their own in My profile
--       date_display             gregorian / hijri (Umm al-Qura) / dual — how the app shows dates (FR-SCH-07)
--       working_days             the organization's default working week, 0 = Sunday … 6 = Saturday (as
--                                JavaScript's getDay); branches get their own week later (HR, working
--                                calendars — data model §2.2)
--       work_starts_at / _ends_at  default working hours (local wall-clock time in `timezone`)
--   Defaults for existing and new organizations: Saudi riyal, Asia/Riyadh, Sunday–Thursday 08:00–16:00,
--   fiscal year from January, English for new people (PO decision, 14 Oct 2026: English is the default
--   language for now) and Gregorian dates; dates and time zone stay what the app showed before this
--   table existed (the backfill takes the headquarters branch's zone, 20261017090100).
--   Writers: the Organization Admin — the action checks platform.tenant.manage (high risk: getUser());
--   the update policy checks the role here. No authenticator code (PO decision, 14 Oct 2026). Members
--   read their organization's settings (every page formats dates with them). Only the settings columns
--   are updatable; the trigger stamps updated_* / version and checks the time zone against the database's
--   own list.

create table platform.tenant_settings (
  tenant_id uuid primary key references platform.tenants (id),
  industry text,
  country_code text,
  currency_code text not null default 'SAR',
  timezone text not null default 'Asia/Riyadh',
  fiscal_year_start_month smallint not null default 1,
  default_locale text not null default 'en',
  date_display text not null default 'gregorian',
  working_days smallint[] not null default '{0,1,2,3,4}',
  work_starts_at time not null default '08:00',
  work_ends_at time not null default '16:00',
  -- [std] without id (one row per organization): who changed it last, and a concurrency token.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  constraint tenant_settings_industry_check
    check (industry is null or industry in (
      'government', 'banking_financial', 'insurance', 'healthcare', 'education', 'oil_gas_energy',
      'manufacturing', 'retail_consumer', 'telecom_technology', 'construction_real_estate',
      'transport_logistics', 'hospitality_tourism', 'professional_services', 'non_profit', 'other')),
  constraint tenant_settings_country_code_check check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint tenant_settings_currency_code_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint tenant_settings_timezone_check
    check (timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$' and length(timezone) <= 64),
  constraint tenant_settings_fiscal_year_start_month_check check (fiscal_year_start_month between 1 and 12),
  constraint tenant_settings_default_locale_check check (default_locale in ('ar', 'en')),
  constraint tenant_settings_date_display_check check (date_display in ('gregorian', 'hijri', 'dual')),
  -- A non-empty subset of the seven days (duplicates are removed and the days sorted by the trigger).
  constraint tenant_settings_working_days_check
    check (cardinality(working_days) between 1 and 7 and array_position(working_days, null) is null
           and working_days <@ '{0,1,2,3,4,5,6}'::smallint[]),
  -- Whole minutes, the end after the start (no working day across midnight).
  constraint tenant_settings_working_hours_check
    check (work_ends_at > work_starts_at
           and extract(second from work_starts_at) = 0 and extract(second from work_ends_at) = 0),
  constraint tenant_settings_updated_by_fkey
    foreign key (tenant_id, updated_by) references platform.persons (tenant_id, id)
);
comment on table platform.tenant_settings is
  'Organization profile and regional settings (FR-ADM-02, FR-SCH-07, BR-ADM-3; T-M2-22). Owner: platform. Class: T. Changed only by the Organization Admin; read by every member.';
comment on column platform.tenant_settings.working_days is
  'Default working week: 0 = Sunday … 6 = Saturday, sorted, no duplicates. Branches override it later (working calendars).';
comment on column platform.tenant_settings.date_display is
  'gregorian / hijri (Umm al-Qura) / dual — how dates are shown to the organization''s members (FR-SCH-07).';

-- May the signed-in member change the organization's profile and settings? An Organization Admin (role
-- in force now) — no authenticator code (PO decision, 14 Oct 2026, reversing D-IAM-01; the organization's
-- MFA sign-in policy is the second factor). SECURITY INVOKER: the caller reads its own organization's roles.
create or replace function private.actor_may_manage_tenant(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select 'tenant_admin' = any (private.actor_role_codes(p_tenant_id, private.request_user_id()));
$$;

comment on function private.actor_may_manage_tenant(uuid) is
  'SECURITY-RELEVANT (T-M2-22): an Organization Admin (role in force now) may change the organization''s profile and settings.';

revoke all on function private.actor_may_manage_tenant(uuid) from public;
grant execute on function private.actor_may_manage_tenant(uuid) to authenticated;

-- [std]-style stamps from verified claims; the working week sorted without duplicates; the time zone one
-- the database knows (so SQL can use it in `at time zone`), checked only when it changes.
create or replace function private.stamp_tenant_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.working_days := array(select distinct d from unnest(new.working_days) d order by d);
  if (tg_op = 'INSERT' or new.timezone is distinct from old.timezone)
     and not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    raise exception 'unknown time zone' using errcode = 'check_violation',
      constraint = 'tenant_settings_timezone_check';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := new.created_at;
    new.updated_by := private.request_person_id();
    new.version := 1;
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'the organization of its settings cannot change' using errcode = 'insufficient_privilege';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.updated_by := private.request_person_id();
  new.version := old.version + 1;
  return new;
end
$$;

comment on function private.stamp_tenant_settings() is
  'SECURITY-RELEVANT. Stamps updated_*/version from verified claims; normalizes the working week; checks the time zone (T-M2-22).';

revoke all on function private.stamp_tenant_settings() from public;

create trigger tenant_settings_stamp before insert or update on platform.tenant_settings
  for each row execute function private.stamp_tenant_settings();

-- Every new organization gets the default settings (provisioning is a platform operation).
create or replace function private.create_tenant_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into platform.tenant_settings (tenant_id) values (new.id);
  return new;
end
$$;

comment on function private.create_tenant_settings() is
  'Creates the default settings of a new organization (T-M2-22).';

revoke all on function private.create_tenant_settings() from public;

create trigger tenants_settings after insert on platform.tenants
  for each row execute function private.create_tenant_settings();

alter table platform.tenant_settings enable row level security;
alter table platform.tenant_settings force row level security;

create policy tenant_isolation on platform.tenant_settings
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Every member (and the organization's jobs) reads them: dates, time zone, language of new people.
create policy tenant_settings_read on platform.tenant_settings for select to authenticated using (true);
create policy tenant_settings_update on platform.tenant_settings for update to authenticated
  using (private.actor_may_manage_tenant(tenant_id))
  with check (private.actor_may_manage_tenant(tenant_id));

revoke all on platform.tenant_settings from public, anon;
grant select on platform.tenant_settings to authenticated;
grant update (industry, country_code, currency_code, timezone, fiscal_year_start_month, default_locale,
              date_display, working_days, work_starts_at, work_ends_at)
  on platform.tenant_settings to authenticated;
