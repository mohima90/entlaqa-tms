-- Customizable training needs forms (T-M3-10; FR-PLN-02, FR-PLN-03; PO, 17 Oct 2026 — business flow
-- docs/business-flows/EP-PLN-planning-cycle.md §12, copied from Kawadir ATS's application-form builder with
-- the agreed fixes). Class: T [std]. PII: none (labels and options written by the L&D Manager; ids).
--
--   tms.needs_forms          the organization's forms library: names (English, Arabic — each unique in the
--                            organization, case-insensitive), default (exactly one per organization),
--                            active (offered for new cycles), locked_at (used by a launched cycle).
--   tms.needs_form_sections  sections of a form: names, descriptions, shown/hidden, repeatable with
--                            min/max entries («add another need»), order.
--   tms.needs_form_fields    fields of a section: 12 types (text, textarea, number, date, email, phone, url,
--                            select, multiselect, radio, checkbox, file) + the system type `people`;
--                            English and Arabic labels and placeholders, required, shown/hidden, order,
--                            options in both languages (select / multiselect / radio), ONE show-if
--                            condition on a select or radio field of the same section.
--
-- Rules, enforced here for every writer (the application checks them first — modules/tms needs-forms):
--   * only a member holding tms.needs_form.manage organization-wide (the L&D Manager) creates, changes or
--     deletes forms, sections and fields; system jobs never do; platform operations (migrations, the
--     organization's creation) may. Locking a form (private.lock_needs_form) is open to any signed-in member
--     of the organization: it is one-way and the calling action (the cycle launch) authorizes it;
--   * system fields (system_key): the training topic (short text) and the people field (number of people /
--     named employees) of every form — always there (a form gets both when created, they are never deleted
--     unless their form is), always required and shown, never conditional; only their labels, placeholders,
--     order and (people) mode change. A section holding one is never hidden or deleted;
--   * a LOCKED form (used by a launched cycle) keeps its sections and fields as they are: no insert, update
--     or delete — duplicate it to change it; it is never unlocked (JN001). Its names and its library state
--     (default, active) may still change — they are labels, not the form the cycle collected answers with;
--   * the default form is active, is not deleted, and every organization with forms has exactly one (JN003,
--     checked at commit so a default can move from one form to another in one transaction);
--   * a condition points at a select or radio field of the same section, with one of its option values, and
--     never loops; a field others depend on keeps the type and the option values they use (JN004). Deleting
--     a field clears the conditions that pointed at it (the dependants become always shown).
-- Error codes: JN001 locked form · JN002 system field / section rule · JN003 default form rule ·
-- JN004 condition rule · JN005 too many sections or fields.
--
-- private.lock_needs_form(form_id) is what the planning cycle's launch calls (T-M3-04) to lock the cycle's
-- form; a cycle referencing the form through a foreign key also keeps it from being deleted.

-- ---------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------
-- Options of a choice field: a JSON array of 1–100 objects {value, label_en, label_ar}; values are short
-- lower-case keys, distinct; labels trimmed, 1–120 characters. Other field types have no options.
create or replace function private.needs_form_options_valid(p_type text, p_options jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when p_type in ('select', 'multiselect', 'radio') then
      p_options is not null
      and jsonb_typeof(p_options) = 'array'
      and jsonb_array_length(p_options) between 1 and 100
      and not exists (
        select 1 from jsonb_array_elements(p_options) o
        where case
                when jsonb_typeof(o) <> 'object' then true
                when not (o ?& array['value', 'label_en', 'label_ar']) then true
                when (select count(*) from jsonb_object_keys(o)) <> 3 then true
                when jsonb_typeof(o -> 'value') <> 'string' or jsonb_typeof(o -> 'label_en') <> 'string'
                     or jsonb_typeof(o -> 'label_ar') <> 'string' then true
                when (o ->> 'value') !~ '^[a-z0-9_]{1,40}$' then true
                when (o ->> 'label_en') <> btrim(o ->> 'label_en')
                     or char_length(o ->> 'label_en') not between 1 and 120 then true
                when (o ->> 'label_ar') <> btrim(o ->> 'label_ar')
                     or char_length(o ->> 'label_ar') not between 1 and 120 then true
                else false
              end)
      and (select count(distinct o ->> 'value') from jsonb_array_elements(p_options) o)
          = jsonb_array_length(p_options)
    else p_options is null
  end;
$$;

comment on function private.needs_form_options_valid(text, jsonb) is
  'Options of a needs-form field (T-M3-10): choice types carry 1–100 {value, label_en, label_ar}, others none.';

revoke all on function private.needs_form_options_valid(text, jsonb) from public;
grant execute on function private.needs_form_options_valid(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------
create table tms.needs_forms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  name_en text not null
    constraint needs_forms_name_en_check check (name_en = btrim(name_en) and char_length(name_en) between 1 and 120),
  name_ar text not null
    constraint needs_forms_name_ar_check check (name_ar = btrim(name_ar) and char_length(name_ar) between 1 and 120),
  is_default boolean not null default false,
  is_active boolean not null default true,
  -- Used by a launched planning cycle (private.lock_needs_form): sections and fields are frozen for good.
  locked_at timestamptz,
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  constraint needs_forms_default_active_check check (not is_default or is_active)
);
comment on table tms.needs_forms is
  'Training needs forms of an organization (FR-PLN-02/03, T-M3-10). Owner: tms. Class: T [std].';

create unique index needs_forms_tenant_default_uq on tms.needs_forms (tenant_id) where is_default;
create unique index needs_forms_tenant_name_en_uq on tms.needs_forms (tenant_id, lower(name_en));
create unique index needs_forms_tenant_name_ar_uq on tms.needs_forms (tenant_id, lower(name_ar));

create table tms.needs_form_sections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  form_id uuid not null,
  name_en text not null
    constraint needs_form_sections_name_en_check check (name_en = btrim(name_en) and char_length(name_en) between 1 and 120),
  name_ar text not null
    constraint needs_form_sections_name_ar_check check (name_ar = btrim(name_ar) and char_length(name_ar) between 1 and 120),
  description_en text
    constraint needs_form_sections_description_en_check
    check (description_en is null or (description_en = btrim(description_en) and char_length(description_en) between 1 and 500)),
  description_ar text
    constraint needs_form_sections_description_ar_check
    check (description_ar is null or (description_ar = btrim(description_ar) and char_length(description_ar) between 1 and 500)),
  is_repeatable boolean not null default false,
  min_entries smallint not null default 1,
  max_entries smallint not null default 1,
  is_visible boolean not null default true,
  sort_order integer not null default 0 constraint needs_form_sections_sort_order_check check (sort_order >= 0),
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, form_id, id),
  -- One entry when not repeatable; 0–50 to 1–50 entries when repeatable.
  constraint needs_form_sections_entries_check check (
    (not is_repeatable and min_entries = 1 and max_entries = 1)
    or (is_repeatable and min_entries between 0 and 50 and max_entries between 1 and 50 and min_entries <= max_entries)),
  foreign key (tenant_id, form_id) references tms.needs_forms (tenant_id, id) on delete cascade
);
comment on table tms.needs_form_sections is
  'Sections of a training needs form (FR-PLN-03, T-M3-10). Owner: tms. Class: T [std].';

create index needs_form_sections_tenant_form_idx on tms.needs_form_sections (tenant_id, form_id, sort_order);

create table tms.needs_form_fields (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  form_id uuid not null,
  section_id uuid not null,
  -- The two fields every form keeps (consolidation merges needs by topic and counts sessions by people).
  system_key text constraint needs_form_fields_system_key_check check (system_key in ('training_topic', 'people')),
  field_type text not null
    constraint needs_form_fields_field_type_check
    check (field_type in ('text', 'textarea', 'number', 'date', 'email', 'phone', 'url', 'select', 'multiselect',
                          'radio', 'checkbox', 'file', 'people')),
  label_en text not null
    constraint needs_form_fields_label_en_check check (label_en = btrim(label_en) and char_length(label_en) between 1 and 200),
  label_ar text not null
    constraint needs_form_fields_label_ar_check check (label_ar = btrim(label_ar) and char_length(label_ar) between 1 and 200),
  placeholder_en text
    constraint needs_form_fields_placeholder_en_check
    check (placeholder_en is null or (placeholder_en = btrim(placeholder_en) and char_length(placeholder_en) between 1 and 200)),
  placeholder_ar text
    constraint needs_form_fields_placeholder_ar_check
    check (placeholder_ar is null or (placeholder_ar = btrim(placeholder_ar) and char_length(placeholder_ar) between 1 and 200)),
  is_required boolean not null default false,
  is_visible boolean not null default true,
  sort_order integer not null default 0 constraint needs_form_fields_sort_order_check check (sort_order >= 0),
  options jsonb,
  -- The people field: a number of people, named employees from the head's team, or either.
  people_mode text
    constraint needs_form_fields_people_mode_check check (people_mode in ('count', 'employees', 'count_or_employees')),
  -- Show only when the field condition_field_id (select or radio, same section) has the answer condition_value.
  condition_field_id uuid,
  condition_value text
    constraint needs_form_fields_condition_value_check check (condition_value is null or condition_value ~ '^[a-z0-9_]{1,40}$'),
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, section_id, id),
  constraint needs_form_fields_options_check check (private.needs_form_options_valid(field_type, options)),
  constraint needs_form_fields_people_check check ((field_type = 'people') = (people_mode is not null)),
  constraint needs_form_fields_system_type_check check (
    case system_key
      when 'training_topic' then field_type = 'text'
      when 'people' then field_type = 'people'
      else field_type <> 'people'
    end),
  constraint needs_form_fields_system_rules_check check (
    system_key is null or (is_required and is_visible and condition_field_id is null)),
  constraint needs_form_fields_condition_check check (
    condition_field_id is null or (condition_value is not null and condition_field_id <> id)),
  foreign key (tenant_id, form_id, section_id) references tms.needs_form_sections (tenant_id, form_id, id)
    on delete cascade,
  -- Same section by construction; deleting the field it depends on clears the condition.
  constraint needs_form_fields_condition_field_fkey foreign key (tenant_id, section_id, condition_field_id)
    references tms.needs_form_fields (tenant_id, section_id, id) on delete set null (condition_field_id)
);
comment on table tms.needs_form_fields is
  'Fields of a training needs form section (FR-PLN-03, T-M3-10). Owner: tms. Class: T [std].';

create unique index needs_form_fields_form_system_key_uq on tms.needs_form_fields (tenant_id, form_id, system_key)
  where system_key is not null;
create index needs_form_fields_tenant_section_idx on tms.needs_form_fields (tenant_id, section_id, sort_order);
create index needs_form_fields_tenant_form_idx on tms.needs_form_fields (tenant_id, form_id);
create index needs_form_fields_tenant_condition_idx on tms.needs_form_fields (tenant_id, section_id, condition_field_id)
  where condition_field_id is not null;

-- ---------------------------------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------------------------------
-- The actor of a needs-form change: a signed-in member holding tms.needs_form.manage organization-wide.
-- Platform operations (no `authenticated` role) pass; rows of another organization are left to row-level
-- security.
create or replace function private.check_needs_form_actor(p_tenant_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_kind text;
  v_user uuid;
begin
  if current_user <> 'authenticated' then
    return false;  -- platform operation: no actor rules
  end if;
  if p_tenant_id is distinct from private.current_tenant_id() then
    return false;  -- the restrictive tenant_isolation policy rejects it
  end if;
  v_kind := private.request_claims() ->> 'role';
  v_user := private.request_user_id();
  if v_kind = 'system' then
    raise exception 'system jobs cannot change needs forms' using errcode = 'insufficient_privilege';
  end if;
  if v_kind is distinct from 'authenticated' or v_user is null then
    raise exception 'unexpected claims for a needs-form change' using errcode = 'insufficient_privilege';
  end if;
  if not private.member_has_permission(p_tenant_id, v_user, 'tms.needs_form.manage') then
    raise exception 'only an L&D Manager can design needs forms' using errcode = 'insufficient_privilege';
  end if;
  return true;
end
$$;

comment on function private.check_needs_form_actor(uuid) is
  'SECURITY-RELEVANT (T-M3-10). Needs forms are changed by holders of tms.needs_form.manage organization-wide only.';

revoke all on function private.check_needs_form_actor(uuid) from public;
grant execute on function private.check_needs_form_actor(uuid) to authenticated;

-- Is the form locked (used by a launched cycle)? NULL form (deleted with its parent) → false.
create or replace function private.needs_form_locked(p_tenant_id uuid, p_form_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((select f.locked_at is not null from tms.needs_forms f
                   where f.tenant_id = p_tenant_id and f.id = p_form_id), false);
$$;

revoke all on function private.needs_form_locked(uuid, uuid) from public;
grant execute on function private.needs_form_locked(uuid, uuid) to authenticated;

create or replace function private.check_needs_form()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.check_needs_form_actor(new.tenant_id);
    if current_user = 'authenticated' then
      new.locked_at := null;  -- a form is locked by a cycle's launch only
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    perform private.check_needs_form_actor(old.tenant_id);
    if old.is_default then
      raise exception 'the default needs form cannot be deleted' using errcode = 'JN003';
    end if;
    if old.locked_at is not null then
      raise exception 'this needs form is used by a launched planning cycle and cannot be deleted' using errcode = 'JN001';
    end if;
    return old;
  end if;
  if (new.id, new.tenant_id) is distinct from (old.id, old.tenant_id) then
    raise exception 'the id and organization of a needs form cannot change' using errcode = 'insufficient_privilege';
  end if;
  if old.locked_at is not null and new.locked_at is distinct from old.locked_at then
    if current_user = 'authenticated' then
      raise exception 'a locked needs form stays locked; duplicate it to change it' using errcode = 'JN001';
    end if;
  elsif old.locked_at is null and new.locked_at is not null then
    new.locked_at := now();
    -- Locking alone (the cycle launch, private.lock_needs_form): any signed-in member; anything else with it
    -- needs the designer's permission.
    if (to_jsonb(new) - 'locked_at') = (to_jsonb(old) - 'locked_at') then
      return new;
    end if;
  end if;
  perform private.check_needs_form_actor(new.tenant_id);
  return new;
end
$$;

comment on function private.check_needs_form() is
  'SECURITY-RELEVANT (T-M3-10). Who changes needs forms; the default and locked forms are not deleted; locks are one-way.';

revoke all on function private.check_needs_form() from public;

-- At commit: an organization with needs forms has exactly one default (the unique index allows at most one).
create or replace function private.check_needs_form_default()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
begin
  if exists (select 1 from tms.needs_forms f where f.tenant_id = v_tenant)
     and not exists (select 1 from tms.needs_forms f where f.tenant_id = v_tenant and f.is_default) then
    raise exception 'an organization keeps one default needs form; choose another default first'
      using errcode = 'JN003';
  end if;
  return null;
end
$$;

revoke all on function private.check_needs_form_default() from public;

-- At commit: a new form has both system fields.
create or replace function private.check_needs_form_system_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from tms.needs_forms f where f.tenant_id = new.tenant_id and f.id = new.id)
     and (select count(distinct x.system_key) from tms.needs_form_fields x
          where x.tenant_id = new.tenant_id and x.form_id = new.id and x.system_key is not null) <> 2 then
    raise exception 'a needs form keeps its training topic and people fields' using errcode = 'JN002';
  end if;
  return null;
end
$$;

revoke all on function private.check_needs_form_system_fields() from public;

create or replace function private.check_needs_form_section()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row tms.needs_form_sections := case when tg_op = 'DELETE' then old else new end;
  v_has_system boolean;
begin
  if tg_op = 'UPDATE' and (new.id, new.tenant_id, new.form_id) is distinct from (old.id, old.tenant_id, old.form_id) then
    raise exception 'a section stays in its form' using errcode = 'insufficient_privilege';
  end if;
  if private.needs_form_locked(v_row.tenant_id, v_row.form_id) then
    raise exception 'this needs form is used by a launched planning cycle; duplicate it to change it'
      using errcode = 'JN001';
  end if;
  perform private.check_needs_form_actor(v_row.tenant_id);
  if tg_op = 'INSERT' then
    if (select count(*) from tms.needs_form_sections s
        where s.tenant_id = new.tenant_id and s.form_id = new.form_id) >= 30 then
      raise exception 'a needs form has at most 30 sections' using errcode = 'JN005';
    end if;
    return new;
  end if;
  v_has_system := exists (select 1 from tms.needs_form_fields x
                          where x.tenant_id = v_row.tenant_id and x.section_id = v_row.id and x.system_key is not null);
  if tg_op = 'UPDATE' then
    if v_has_system and not new.is_visible then
      raise exception 'the section with the training topic and people fields is always shown' using errcode = 'JN002';
    end if;
    return new;
  end if;
  -- DELETE: with the system fields only together with its form.
  if v_has_system and exists (select 1 from tms.needs_forms f where f.tenant_id = old.tenant_id and f.id = old.form_id) then
    raise exception 'the section with the training topic and people fields cannot be deleted' using errcode = 'JN002';
  end if;
  return old;
end
$$;

comment on function private.check_needs_form_section() is
  'SECURITY-RELEVANT (T-M3-10). Sections of needs forms: designer only, frozen when the form is locked, the system section stays.';

revoke all on function private.check_needs_form_section() from public;

create or replace function private.check_needs_form_field()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row tms.needs_form_fields := case when tg_op = 'DELETE' then old else new end;
  v_target tms.needs_form_fields;
  v_cursor uuid;
  v_steps integer := 0;
begin
  if tg_op = 'UPDATE'
     and (new.id, new.tenant_id, new.form_id, new.section_id, new.system_key)
         is distinct from (old.id, old.tenant_id, old.form_id, old.section_id, old.system_key) then
    raise exception 'a field stays in its section and keeps its system role' using errcode = 'insufficient_privilege';
  end if;
  if private.needs_form_locked(v_row.tenant_id, v_row.form_id) then
    raise exception 'this needs form is used by a launched planning cycle; duplicate it to change it'
      using errcode = 'JN001';
  end if;
  perform private.check_needs_form_actor(v_row.tenant_id);
  if tg_op = 'DELETE' then
    -- A system field goes only with its section (that is: with its form).
    if old.system_key is not null
       and exists (select 1 from tms.needs_form_sections s where s.tenant_id = old.tenant_id and s.id = old.section_id) then
      raise exception 'the training topic and people fields cannot be deleted' using errcode = 'JN002';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT'
     and (select count(*) from tms.needs_form_fields x
          where x.tenant_id = new.tenant_id and x.section_id = new.section_id) >= 60 then
    raise exception 'a section has at most 60 fields' using errcode = 'JN005';
  end if;
  if tg_op = 'UPDATE' and old.system_key = 'people' and new.field_type <> old.field_type then
    raise exception 'the people field keeps its type' using errcode = 'JN002';
  end if;
  -- The condition: a select or radio field of the same section (foreign key), one of its values, no loop.
  if new.condition_field_id is not null then
    select * into v_target from tms.needs_form_fields x
    where x.tenant_id = new.tenant_id and x.id = new.condition_field_id;
    if v_target.id is null or v_target.field_type not in ('select', 'radio')
       or not exists (select 1 from jsonb_array_elements(v_target.options) o where o ->> 'value' = new.condition_value) then
      raise exception 'a condition needs a dropdown or single-choice field of the same section and one of its answers'
        using errcode = 'JN004';
    end if;
    v_cursor := v_target.condition_field_id;
    while v_cursor is not null loop
      v_steps := v_steps + 1;
      if v_cursor = new.id or v_steps > 60 then
        raise exception 'conditions cannot go round in a circle' using errcode = 'JN004';
      end if;
      select x.condition_field_id into v_cursor from tms.needs_form_fields x
      where x.tenant_id = new.tenant_id and x.id = v_cursor;
    end loop;
  end if;
  -- Fields that depend on this one keep a valid condition.
  if tg_op = 'UPDATE' and (new.field_type, new.options) is distinct from (old.field_type, old.options)
     and exists (select 1 from tms.needs_form_fields d
                 where d.tenant_id = new.tenant_id and d.section_id = new.section_id and d.condition_field_id = new.id
                   and (new.field_type not in ('select', 'radio')
                        or not exists (select 1 from jsonb_array_elements(new.options) o
                                       where o ->> 'value' = d.condition_value))) then
    raise exception 'other fields are shown on an answer of this field; change their conditions first'
      using errcode = 'JN004';
  end if;
  return new;
end
$$;

comment on function private.check_needs_form_field() is
  'SECURITY-RELEVANT (T-M3-10). Fields of needs forms: designer only, frozen when the form is locked, system fields stay, valid conditions.';

revoke all on function private.check_needs_form_field() from public;

create trigger needs_forms_guard before insert or update or delete on tms.needs_forms
  for each row execute function private.check_needs_form();
create trigger needs_forms_stamp_row before insert or update on tms.needs_forms
  for each row execute function private.stamp_row();
create constraint trigger needs_forms_one_default after insert or update or delete on tms.needs_forms
  deferrable initially deferred for each row execute function private.check_needs_form_default();
create constraint trigger needs_forms_system_fields after insert on tms.needs_forms
  deferrable initially deferred for each row execute function private.check_needs_form_system_fields();

create trigger needs_form_sections_guard before insert or update or delete on tms.needs_form_sections
  for each row execute function private.check_needs_form_section();
create trigger needs_form_sections_stamp_row before insert or update on tms.needs_form_sections
  for each row execute function private.stamp_row();

create trigger needs_form_fields_guard before insert or update or delete on tms.needs_form_fields
  for each row execute function private.check_needs_form_field();
create trigger needs_form_fields_stamp_row before insert or update on tms.needs_form_fields
  for each row execute function private.stamp_row();

-- ---------------------------------------------------------------------------------------------------
-- Locking (the planning cycle's launch, T-M3-04)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.lock_needs_form(p_form_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update tms.needs_forms set locked_at = now() where id = p_form_id and locked_at is null;
  return exists (select 1 from tms.needs_forms f where f.id = p_form_id and f.locked_at is not null);
end
$$;

comment on function private.lock_needs_form(uuid) is
  'Locks a needs form for good (T-M3-10): called by the planning cycle launch (T-M3-04) in its transaction. True when the form (of the caller''s organization) is locked afterwards; false when it is unknown.';

revoke all on function private.lock_needs_form(uuid) from public;
grant execute on function private.lock_needs_form(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Duplicate a form (sections, fields, conditions re-pointed at the copies)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.duplicate_needs_form(p_form_id uuid, p_name_en text, p_name_ar text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_source tms.needs_forms;
  v_new uuid := gen_random_uuid();
  v_section_map jsonb := '{}';
  v_field_map jsonb := '{}';
  r record;
  v_id uuid;
begin
  select * into v_source from tms.needs_forms f where f.id = p_form_id;
  if v_source.id is null then
    return null;
  end if;
  insert into tms.needs_forms (id, tenant_id, name_en, name_ar, is_default, is_active)
  values (v_new, v_source.tenant_id, p_name_en, p_name_ar, false, true);
  for r in select * from tms.needs_form_sections s
           where s.tenant_id = v_source.tenant_id and s.form_id = v_source.id order by s.sort_order, s.id loop
    v_id := gen_random_uuid();
    v_section_map := v_section_map || jsonb_build_object(r.id::text, v_id::text);
    insert into tms.needs_form_sections (id, tenant_id, form_id, name_en, name_ar, description_en, description_ar,
                                         is_repeatable, min_entries, max_entries, is_visible, sort_order)
    values (v_id, r.tenant_id, v_new, r.name_en, r.name_ar, r.description_en, r.description_ar,
            r.is_repeatable, r.min_entries, r.max_entries, r.is_visible, r.sort_order);
  end loop;
  -- Fields first without their conditions, then the conditions with the copies' ids.
  for r in select * from tms.needs_form_fields x
           where x.tenant_id = v_source.tenant_id and x.form_id = v_source.id order by x.sort_order, x.id loop
    v_id := gen_random_uuid();
    v_field_map := v_field_map || jsonb_build_object(r.id::text, v_id::text);
    insert into tms.needs_form_fields (id, tenant_id, form_id, section_id, system_key, field_type, label_en, label_ar,
                                       placeholder_en, placeholder_ar, is_required, is_visible, sort_order, options,
                                       people_mode)
    values (v_id, r.tenant_id, v_new, (v_section_map ->> r.section_id::text)::uuid, r.system_key, r.field_type,
            r.label_en, r.label_ar, r.placeholder_en, r.placeholder_ar, r.is_required, r.is_visible, r.sort_order,
            r.options, r.people_mode);
  end loop;
  for r in select * from tms.needs_form_fields x
           where x.tenant_id = v_source.tenant_id and x.form_id = v_source.id and x.condition_field_id is not null loop
    update tms.needs_form_fields
    set condition_field_id = (v_field_map ->> r.condition_field_id::text)::uuid, condition_value = r.condition_value
    where tenant_id = r.tenant_id and id = (v_field_map ->> r.id::text)::uuid;
  end loop;
  return v_new;
end
$$;

comment on function private.duplicate_needs_form(uuid, text, text) is
  'Copies a needs form of the caller''s organization (T-M3-10) under new names: sections, fields, conditions re-pointed at the copies. NULL when the form is unknown. The guards apply (designer only).';

revoke all on function private.duplicate_needs_form(uuid, text, text) from public;
grant execute on function private.duplicate_needs_form(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------------------------------
alter table tms.needs_forms enable row level security;
alter table tms.needs_forms force row level security;
create policy tenant_isolation on tms.needs_forms
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Every member reads the forms (the needs page renders the cycle's form); the guards decide who writes.
create policy needs_forms_read on tms.needs_forms for select to authenticated using (true);
create policy needs_forms_insert on tms.needs_forms for insert to authenticated with check (true);
create policy needs_forms_update on tms.needs_forms for update to authenticated using (true) with check (true);
create policy needs_forms_delete on tms.needs_forms for delete to authenticated using (true);
revoke all on tms.needs_forms from public, anon;
grant select, delete on tms.needs_forms to authenticated;
grant insert (id, tenant_id, name_en, name_ar, is_default, is_active) on tms.needs_forms to authenticated;
grant update (name_en, name_ar, is_default, is_active, locked_at) on tms.needs_forms to authenticated;

alter table tms.needs_form_sections enable row level security;
alter table tms.needs_form_sections force row level security;
create policy tenant_isolation on tms.needs_form_sections
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy needs_form_sections_read on tms.needs_form_sections for select to authenticated using (true);
create policy needs_form_sections_insert on tms.needs_form_sections for insert to authenticated with check (true);
create policy needs_form_sections_update on tms.needs_form_sections for update to authenticated using (true) with check (true);
create policy needs_form_sections_delete on tms.needs_form_sections for delete to authenticated using (true);
revoke all on tms.needs_form_sections from public, anon;
grant select, delete on tms.needs_form_sections to authenticated;
grant insert (id, tenant_id, form_id, name_en, name_ar, description_en, description_ar, is_repeatable, min_entries,
              max_entries, is_visible, sort_order)
  on tms.needs_form_sections to authenticated;
grant update (name_en, name_ar, description_en, description_ar, is_repeatable, min_entries, max_entries, is_visible,
              sort_order)
  on tms.needs_form_sections to authenticated;

alter table tms.needs_form_fields enable row level security;
alter table tms.needs_form_fields force row level security;
create policy tenant_isolation on tms.needs_form_fields
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy needs_form_fields_read on tms.needs_form_fields for select to authenticated using (true);
create policy needs_form_fields_insert on tms.needs_form_fields for insert to authenticated with check (true);
create policy needs_form_fields_update on tms.needs_form_fields for update to authenticated using (true) with check (true);
create policy needs_form_fields_delete on tms.needs_form_fields for delete to authenticated using (true);
revoke all on tms.needs_form_fields from public, anon;
grant select, delete on tms.needs_form_fields to authenticated;
grant insert (id, tenant_id, form_id, section_id, system_key, field_type, label_en, label_ar, placeholder_en,
              placeholder_ar, is_required, is_visible, sort_order, options, people_mode, condition_field_id,
              condition_value)
  on tms.needs_form_fields to authenticated;
grant update (field_type, label_en, label_ar, placeholder_en, placeholder_ar, is_required, is_visible, sort_order,
              options, people_mode, condition_field_id, condition_value)
  on tms.needs_form_fields to authenticated;
