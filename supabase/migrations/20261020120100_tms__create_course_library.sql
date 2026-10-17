-- Course library (T-M3-03; FR-CAT-01, FR-CAT-10 minimal; business flow EP-PLN step A2 and Q10, agreed by the
-- PO on 17 Oct 2026). ADR 0002 §6 pattern. Class: T [std]. PII: none (course and category texts written by
-- the organization's training staff; person ids in the [std] / archive columns).
--
--   tms.course_categories  the organization's own flat list of categories (names AR/EN, each unique in the
--                          organization regardless of case). Hierarchy (FR-CAT-01 "hierarchical") comes
--                          later with a parent column (expand-only).
--   tms.courses            code (unique in the organization regardless of case), titles AR/EN, short
--                          descriptions AR/EN, category, delivery type, duration in hours (required) and
--                          days (optional), minimum and maximum participants (min <= max), the estimated
--                          cost per session and the optional cost per participant used for planning
--                          (EP-PLN Q10) with the currency they are in, and active / archived. Courses are
--                          never deleted: they are archived (planning lines and sessions will reference
--                          them), and restored.
--
-- Currency: the costs are stored in the organization's default currency at the time they were entered
-- (platform.tenant_settings.currency_code, FR-ADM-02): the guard stamps cost_currency whenever a cost is set
-- or changed; an amount keeps its own currency if the organization later changes its default (BR-ADM-2).
--
-- Who may do what (BRD Appendix B «Course library & programs»; permissions of migration 20261020120000):
--   * reading: every member of the organization may read the rows (organization data, no personal data);
--     the application shows the library only to holders of tms.course.read and the costs only to holders
--     of tms.course_cost.read (the same pattern as custom roles and the organization's settings);
--   * adding and editing courses and categories: tms.course.manage organization-wide (L&D Manager,
--     Training Coordinator; custom roles with it);
--   * archiving and restoring: tms.course.archive organization-wide (L&D Manager);
--   * system jobs never change the library; platform operations (migrations, support) may.
-- The guards decide BY PERMISSION (private.member_has_permission), so custom roles work as standard roles.

-- ---------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------
create table tms.course_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  name_en text not null,
  name_ar text not null,
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  constraint course_categories_name_en_check check (
    name_en = btrim(name_en) and char_length(name_en) between 1 and 100 and private.has_visible_text(name_en)),
  constraint course_categories_name_ar_check check (
    name_ar = btrim(name_ar) and char_length(name_ar) between 1 and 100 and private.has_visible_text(name_ar))
);
comment on table tms.course_categories is
  'Course categories of an organization (FR-CAT-01, T-M3-03). Owner: tms. Class: T [std].';

create unique index course_categories_tenant_name_en_uq on tms.course_categories (tenant_id, lower(name_en));
create unique index course_categories_tenant_name_ar_uq on tms.course_categories (tenant_id, lower(name_ar));

create table tms.courses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  code text not null,
  title_en text not null,
  title_ar text not null,
  description_en text,
  description_ar text,
  category_id uuid,
  delivery_type text not null,
  duration_hours numeric(6, 2) not null,
  duration_days numeric(4, 1),
  min_participants integer not null default 1,
  max_participants integer not null,
  est_cost_per_session numeric(12, 2),
  est_cost_per_participant numeric(12, 2),
  cost_currency text,
  status text not null default 'active',
  archived_at timestamptz,
  archived_by uuid,
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  constraint courses_code_check check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  constraint courses_title_en_check check (
    title_en = btrim(title_en) and char_length(title_en) between 1 and 200 and private.has_visible_text(title_en)),
  constraint courses_title_ar_check check (
    title_ar = btrim(title_ar) and char_length(title_ar) between 1 and 200 and private.has_visible_text(title_ar)),
  constraint courses_description_en_check check (description_en is null or (
    char_length(description_en) <= 2000 and private.has_visible_text(description_en))),
  constraint courses_description_ar_check check (description_ar is null or (
    char_length(description_ar) <= 2000 and private.has_visible_text(description_ar))),
  -- FR-CAT-01 delivery types (glossary #42–46): classroom (ILT), virtual (VILT), blended, hybrid,
  -- on-the-job (OJT), workshop, conference, exam, e-learning (through the LMS connection).
  constraint courses_delivery_type_check check (delivery_type in (
    'classroom', 'virtual', 'blended', 'hybrid', 'on_the_job', 'workshop', 'conference', 'exam', 'elearning')),
  constraint courses_duration_hours_check check (duration_hours > 0),
  -- Days, when given, can hold the hours (a day has at most 24 of them).
  constraint courses_duration_days_check check (duration_days is null or (
    duration_days > 0 and duration_days <= 365 and duration_hours <= duration_days * 24)),
  constraint courses_participants_check check (
    min_participants between 1 and 10000 and max_participants between 1 and 10000
    and min_participants <= max_participants),
  constraint courses_cost_check check (
    (est_cost_per_session is null or est_cost_per_session >= 0)
    and (est_cost_per_participant is null or est_cost_per_participant >= 0)),
  -- A currency exactly when there is an amount (stamped by the guard from the organization's settings).
  constraint courses_cost_currency_check check (
    (cost_currency is null) = (est_cost_per_session is null and est_cost_per_participant is null)
    and (cost_currency is null or cost_currency ~ '^[A-Z]{3}$')),
  constraint courses_status_check check (status in ('active', 'archived')),
  constraint courses_archived_check check ((status = 'archived') = (archived_at is not null)
    and (archived_by is null or archived_at is not null)),
  foreign key (tenant_id, category_id) references tms.course_categories (tenant_id, id)
);
comment on table tms.courses is
  'Course library of an organization (FR-CAT-01, FR-CAT-10, T-M3-03). Owner: tms. Class: T [std]. Archived, never deleted.';
comment on column tms.courses.est_cost_per_session is
  'Estimated cost of one session for planning (EP-PLN Q10), in cost_currency; the cost model of FR-CAT-02 replaces it later.';
comment on column tms.courses.cost_currency is
  'ISO 4217 currency of the estimated costs: the organization''s default currency when they were entered (stamped by tms.guard_course).';

create unique index courses_tenant_code_uq on tms.courses (tenant_id, lower(code));
create index courses_tenant_status_idx on tms.courses (tenant_id, status);
create index courses_tenant_category_idx on tms.courses (tenant_id, category_id) where category_id is not null;

-- ---------------------------------------------------------------------------------------------------
-- Guards (SECURITY INVOKER; the caller's own claims and row-level security apply)
-- ---------------------------------------------------------------------------------------------------
-- The actor of a course-library change, for a row of the caller's organization: a signed-in member holding
-- `p_permission` organization-wide. Returns false for platform operations (no actor rules) and for rows of
-- another organization (the restrictive tenant_isolation policy rejects those).
create or replace function tms.course_library_actor(p_tenant_id uuid, p_permission text, p_refusal text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_kind text := private.request_claims() ->> 'role';
  v_user uuid := private.request_user_id();
begin
  if current_user <> 'authenticated' then
    return false;  -- platform operation
  end if;
  if p_tenant_id is distinct from private.current_tenant_id() then
    return false;  -- row-level security rejects it
  end if;
  if v_kind is distinct from 'authenticated' or v_user is null then
    raise exception 'only signed-in members change the course library' using errcode = 'insufficient_privilege';
  end if;
  if not private.member_has_permission(p_tenant_id, v_user, p_permission) then
    raise exception '%', p_refusal using errcode = 'insufficient_privilege';
  end if;
  return true;
end
$$;

comment on function tms.course_library_actor(uuid, text, text) is
  'SECURITY-RELEVANT (T-M3-03). The signed-in member changing the course library must hold the permission organization-wide.';

revoke all on function tms.course_library_actor(uuid, text, text) from public;
grant execute on function tms.course_library_actor(uuid, text, text) to authenticated;

create or replace function tms.guard_course_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.id, new.tenant_id) is distinct from (old.id, old.tenant_id) then
    raise exception 'a category cannot change its id or organization' using errcode = 'insufficient_privilege';
  end if;
  perform tms.course_library_actor(new.tenant_id, 'tms.course.manage',
    'only members who manage the course library can add or change categories');
  return new;
end
$$;

comment on function tms.guard_course_category() is
  'SECURITY-RELEVANT (T-M3-03). Categories are added and renamed by holders of tms.course.manage only.';

revoke all on function tms.guard_course_category() from public;

create or replace function tms.guard_course()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_content_changed boolean;
  v_costs_changed boolean;
begin
  if tg_op = 'INSERT' then
    perform tms.course_library_actor(new.tenant_id, 'tms.course.manage',
      'only members who manage the course library can add courses');
    v_costs_changed := true;
    if new.status = 'archived' then
      new.archived_at := now();
      new.archived_by := private.request_person_id();
    else
      new.archived_at := null;
      new.archived_by := null;
    end if;
  else
    if (new.id, new.tenant_id) is distinct from (old.id, old.tenant_id) then
      raise exception 'a course cannot change its id or organization' using errcode = 'insufficient_privilege';
    end if;
    v_content_changed := (new.code, new.title_en, new.title_ar, new.description_en, new.description_ar,
                          new.category_id, new.delivery_type, new.duration_hours, new.duration_days,
                          new.min_participants, new.max_participants, new.est_cost_per_session,
                          new.est_cost_per_participant)
      is distinct from (old.code, old.title_en, old.title_ar, old.description_en, old.description_ar,
                        old.category_id, old.delivery_type, old.duration_hours, old.duration_days,
                        old.min_participants, old.max_participants, old.est_cost_per_session,
                        old.est_cost_per_participant);
    if v_content_changed then
      perform tms.course_library_actor(new.tenant_id, 'tms.course.manage',
        'only members who manage the course library can change courses');
    end if;
    if new.status is distinct from old.status then
      perform tms.course_library_actor(new.tenant_id, 'tms.course.archive',
        'only members who may archive courses can archive or restore them');
      if new.status = 'archived' then
        new.archived_at := now();
        new.archived_by := private.request_person_id();
      else
        new.archived_at := null;
        new.archived_by := null;
      end if;
    else
      new.archived_at := old.archived_at;
      new.archived_by := old.archived_by;
      if not v_content_changed then
        -- Nothing changed: still only for members who may change the library.
        perform tms.course_library_actor(new.tenant_id, 'tms.course.manage',
          'only members who manage the course library can change courses');
      end if;
    end if;
    v_costs_changed := (new.est_cost_per_session, new.est_cost_per_participant)
      is distinct from (old.est_cost_per_session, old.est_cost_per_participant);
    if not v_costs_changed then
      new.cost_currency := old.cost_currency;
    end if;
  end if;
  -- The costs' currency: the organization's default currency when an amount is entered or changed.
  if new.est_cost_per_session is null and new.est_cost_per_participant is null then
    new.cost_currency := null;
  elsif v_costs_changed or new.cost_currency is null then
    new.cost_currency := (select s.currency_code from platform.tenant_settings s where s.tenant_id = new.tenant_id);
  end if;
  return new;
end
$$;

comment on function tms.guard_course() is
  'SECURITY-RELEVANT (T-M3-03). Courses: added and edited with tms.course.manage, archived and restored with tms.course.archive; stamps the archive columns and the costs'' currency.';

revoke all on function tms.guard_course() from public;

-- Triggers fire in name order: the guard (and its stamps) before the [std] stamp.
create trigger course_categories_guard before insert or update on tms.course_categories
  for each row execute function tms.guard_course_category();
create trigger course_categories_stamp_row before insert or update on tms.course_categories
  for each row execute function private.stamp_row();
create trigger courses_guard before insert or update on tms.courses
  for each row execute function tms.guard_course();
create trigger courses_stamp_row before insert or update on tms.courses
  for each row execute function private.stamp_row();

-- ---------------------------------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------------------------------
alter table tms.course_categories enable row level security;
alter table tms.course_categories force row level security;
create policy tenant_isolation on tms.course_categories
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Who may write is the guard's decision (tms.course.manage); the application decides who sees the library.
create policy course_categories_read on tms.course_categories for select to authenticated using (true);
create policy course_categories_insert on tms.course_categories for insert to authenticated with check (true);
create policy course_categories_update on tms.course_categories for update to authenticated
  using (true) with check (true);
revoke all on tms.course_categories from public, anon;
grant select on tms.course_categories to authenticated;
grant insert (id, tenant_id, name_en, name_ar) on tms.course_categories to authenticated;
grant update (name_en, name_ar) on tms.course_categories to authenticated;

alter table tms.courses enable row level security;
alter table tms.courses force row level security;
create policy tenant_isolation on tms.courses
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Who may write is the guard's decision (tms.course.manage / tms.course.archive). No delete: archive.
create policy courses_read on tms.courses for select to authenticated using (true);
create policy courses_insert on tms.courses for insert to authenticated with check (true);
create policy courses_update on tms.courses for update to authenticated using (true) with check (true);
revoke all on tms.courses from public, anon;
grant select on tms.courses to authenticated;
grant insert (id, tenant_id, code, title_en, title_ar, description_en, description_ar, category_id, delivery_type,
              duration_hours, duration_days, min_participants, max_participants, est_cost_per_session,
              est_cost_per_participant)
  on tms.courses to authenticated;
grant update (code, title_en, title_ar, description_en, description_ar, category_id, delivery_type, duration_hours,
              duration_days, min_participants, max_participants, est_cost_per_session, est_cost_per_participant,
              status)
  on tms.courses to authenticated;
