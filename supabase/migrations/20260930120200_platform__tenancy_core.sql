-- ADR 0002 §2 core tenancy tables + §6 RLS pattern; ADR 0003 §1 identities.
-- Every table: ENABLE + FORCE RLS, RESTRICTIVE tenant_isolation for authenticated, explicit grants,
-- nothing to anon, composite FKs between tenant-owned tables, index on the tenant column.

-- ---------------------------------------------------------------------------------------------
-- platform.tenants
-- ---------------------------------------------------------------------------------------------
create table platform.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  name_ar text not null check (length(btrim(name_ar)) > 0),
  name_en text,
  status text not null default 'trial'
    check (status in ('trial', 'active', 'suspended', 'cancelled')),
  edition text not null default 'standard',
  mode text not null default 'standalone' check (mode in ('suite', 'standalone')),
  data_residency text not null default 'eu-central-1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table platform.tenants is 'Customer organizations (المنشأة). Provisioned by platform operations only.';

create trigger tenants_set_updated_at before update on platform.tenants
  for each row execute function private.set_updated_at();

alter table platform.tenants enable row level security;
alter table platform.tenants force row level security;

create policy tenant_isolation on platform.tenants
  as restrictive for all to authenticated
  using (id = (select private.current_tenant_id()))
  with check (id = (select private.current_tenant_id()));
create policy tenants_read on platform.tenants for select to authenticated using (true);

-- Readers used by claim validation (tenant_guard) and the access-token hook (supabase_auth_admin).
create policy tenants_guard_read on platform.tenants for select to tenant_guard using (true);
create policy tenants_auth_hook_read on platform.tenants for select to supabase_auth_admin using (true);

revoke all on platform.tenants from public, anon;
grant select on platform.tenants to authenticated;
grant select (id, status) on platform.tenants to tenant_guard, supabase_auth_admin;

-- ---------------------------------------------------------------------------------------------
-- platform.tenant_domains (host → tenant; verified domains only are used for resolution)
-- ---------------------------------------------------------------------------------------------
create table platform.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  hostname text not null unique
    check (hostname = lower(hostname) and hostname ~ '^[a-z0-9.-]{1,253}$'),
  kind text not null check (kind in ('subdomain', 'custom')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index tenant_domains_tenant_id_idx on platform.tenant_domains (tenant_id);

alter table platform.tenant_domains enable row level security;
alter table platform.tenant_domains force row level security;

create policy tenant_isolation on platform.tenant_domains
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy tenant_domains_read on platform.tenant_domains for select to authenticated using (true);

revoke all on platform.tenant_domains from public, anon;
grant select on platform.tenant_domains to authenticated;

-- ---------------------------------------------------------------------------------------------
-- platform.persons (people directory shared by all suite modules, FR-STE-02)
-- ---------------------------------------------------------------------------------------------
create table platform.persons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  display_name_ar text not null check (length(btrim(display_name_ar)) > 0),
  display_name_en text,
  email text check (email is null or email = lower(email)),
  employee_number text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index persons_tenant_id_idx on platform.persons (tenant_id);
create unique index persons_tenant_email_uq on platform.persons (tenant_id, email) where email is not null;
create unique index persons_tenant_employee_number_uq on platform.persons (tenant_id, employee_number)
  where employee_number is not null;

create trigger persons_set_updated_at before update on platform.persons
  for each row execute function private.set_updated_at();

alter table platform.persons enable row level security;
alter table platform.persons force row level security;

create policy tenant_isolation on platform.persons
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Fine-grained permissions (platform.person.*) are enforced server-side by defineAction (ADR 0003 §4).
create policy persons_read on platform.persons for select to authenticated using (true);
create policy persons_insert on platform.persons for insert to authenticated with check (true);
create policy persons_update on platform.persons for update to authenticated using (true) with check (true);

revoke all on platform.persons from public, anon;
grant select, insert, update on platform.persons to authenticated;

-- ---------------------------------------------------------------------------------------------
-- platform.tenant_memberships (login ↔ person in a tenant)
-- ---------------------------------------------------------------------------------------------
create table platform.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  person_id uuid not null,
  status text not null default 'invited'
    check (status in ('invited', 'active', 'suspended', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, user_id),
  unique (tenant_id, person_id),
  foreign key (tenant_id, person_id) references platform.persons (tenant_id, id)
);
create index tenant_memberships_tenant_id_idx on platform.tenant_memberships (tenant_id);
create index tenant_memberships_user_id_idx on platform.tenant_memberships (user_id);

create trigger tenant_memberships_set_updated_at before update on platform.tenant_memberships
  for each row execute function private.set_updated_at();

alter table platform.tenant_memberships enable row level security;
alter table platform.tenant_memberships force row level security;

create policy tenant_isolation on platform.tenant_memberships
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy tenant_memberships_read on platform.tenant_memberships for select to authenticated using (true);
-- Invitations and status changes run through defineAction (platform.user.invite / manage); the database
-- additionally prevents member-level privilege escalation (defense in depth, ADR 0003 §5):
--   * request-path code can only create INVITED memberships (never an active one);
--   * it can only change `status` (column grant), and only along the transitions allowed by
--     private.check_membership_status_transition() below — it can suspend or revoke, but never
--     activate an invitation or reactivate a suspended/revoked member. Those transitions are
--     platform operations (withAdminTx) until the invitation-acceptance flow (FR-IAM-03, M2) adds a
--     checked SECURITY DEFINER function for them.
create policy tenant_memberships_insert on platform.tenant_memberships for insert to authenticated
  with check (status = 'invited');
create policy tenant_memberships_update on platform.tenant_memberships for update to authenticated
  using (true) with check (true);

create policy tenant_memberships_guard_read on platform.tenant_memberships for select to tenant_guard using (true);
create policy tenant_memberships_auth_hook_read on platform.tenant_memberships for select to supabase_auth_admin using (true);

revoke all on platform.tenant_memberships from public, anon;
grant select, insert on platform.tenant_memberships to authenticated;
grant update (status) on platform.tenant_memberships to authenticated;
grant select (tenant_id, user_id, person_id, status) on platform.tenant_memberships to tenant_guard, supabase_auth_admin;

-- SECURITY INVOKER trigger: applies to the request/worker path (current_user = authenticated). Platform
-- operations (migration/admin roles) are not restricted here; they are audited (ADR 0002 §7).
create or replace function private.check_membership_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and new.status is distinct from old.status
     and (old.status, new.status) not in (
       ('invited', 'revoked'),
       ('active', 'suspended'),
       ('active', 'revoked'),
       ('suspended', 'revoked')
     ) then
    raise exception 'membership status transition % -> % is not allowed', old.status, new.status
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

comment on function private.check_membership_status_transition() is
  'SECURITY-RELEVANT (ADR 0003 §5). Request-path code may only suspend/revoke memberships, never (re)activate them.';

revoke all on function private.check_membership_status_transition() from public;

create trigger tenant_memberships_status_transition before update on platform.tenant_memberships
  for each row execute function private.check_membership_status_transition();

-- ---------------------------------------------------------------------------------------------
-- platform.session_context (which tenant THIS Auth session acts in — ADR 0002 §2, TM-0001 F-02)
-- ---------------------------------------------------------------------------------------------
create table platform.session_context (
  session_id uuid primary key references auth.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  active_tenant_id uuid not null references platform.tenants (id),
  updated_at timestamptz not null default now(),
  -- The session may only point at a tenant the user is a member of.
  foreign key (active_tenant_id, user_id) references platform.tenant_memberships (tenant_id, user_id)
    on delete cascade
);
create index session_context_active_tenant_id_idx on platform.session_context (active_tenant_id);
create index session_context_user_id_idx on platform.session_context (user_id);

alter table platform.session_context enable row level security;
alter table platform.session_context force row level security;

create policy tenant_isolation on platform.session_context
  as restrictive for all to authenticated
  using (active_tenant_id = (select private.current_tenant_id()))
  with check (active_tenant_id = (select private.current_tenant_id()));
-- A user sees only the context of the session making the request. Writes: private.switch_active_tenant().
create policy session_context_read_own on platform.session_context for select to authenticated
  using (
    user_id = (select private.request_user_id())
    and session_id = (select private.try_uuid(private.request_claims() ->> 'session_id'))
  );

create policy session_context_guard_read on platform.session_context for select to tenant_guard using (true);
create policy session_context_guard_insert on platform.session_context for insert to tenant_guard with check (true);
create policy session_context_guard_update on platform.session_context for update to tenant_guard using (true) with check (true);
create policy session_context_auth_hook_read on platform.session_context for select to supabase_auth_admin using (true);

revoke all on platform.session_context from public, anon;
grant select on platform.session_context to authenticated;
grant select, insert, update on platform.session_context to tenant_guard;
grant select (session_id, user_id, active_tenant_id) on platform.session_context to supabase_auth_admin;

grant usage on schema platform to supabase_auth_admin;
