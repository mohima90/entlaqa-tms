-- db-test: run-as=app_server
-- Planning cycles × needs forms (T-M3-04 × T-M3-10; migration 20261020190000): a new cycle gets the
-- organization's default form, the form is required to launch and locked by the launch in its transaction,
-- a form a cycle uses cannot be deleted, and another organization's form is never a cycle's form. Fixtures:
-- 00_helpers_and_fixtures.sql (forms a7…01 / b7…01, cycle ae…01), 99_planning_a_fixtures_owner.sql (uL, the
-- L&D Manager of A; open cycle ae…02 past its deadline). Each block is rolled back.
-- Dates are the organization's calendar day (private.plan_cycle_today), as the guards use — never current_date.
\set ON_ERROR_STOP on

-- ---- default form, other organizations' forms -----------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
declare
  v_default uuid := (select id from tms.needs_forms where is_default);
  v_id uuid;
begin
  perform tests.assert(v_default is not null, 'tenant A has a default needs form');
  insert into tms.plan_cycles (name_ar, name_en, period_start_on, period_end_on, deadline_on)
    values ('خطة', 'Plan', private.plan_cycle_today('a0000000-0000-4000-8000-000000000001'), private.plan_cycle_today('a0000000-0000-4000-8000-000000000001') + 300, private.plan_cycle_today('a0000000-0000-4000-8000-000000000001') + 10) returning id into v_id;
  perform tests.assert_eq((select needs_form_id from tms.plan_cycles where id = v_id), v_default,
    'a new cycle without a chosen form gets the organization''s default form');
  insert into tms.plan_cycles (name_ar, name_en, period_start_on, period_end_on, deadline_on, needs_form_id)
    values ('خطة ٢', 'Plan 2', private.plan_cycle_today('a0000000-0000-4000-8000-000000000001'), private.plan_cycle_today('a0000000-0000-4000-8000-000000000001') + 300, private.plan_cycle_today('a0000000-0000-4000-8000-000000000001') + 10, 'a7000000-0000-4000-8000-000000000001')
    returning id into v_id;
  perform tests.assert_eq((select needs_form_id from tms.plan_cycles where id = v_id),
    'a7000000-0000-4000-8000-000000000001'::uuid, 'a chosen form is kept');

  -- Tenant B's form (b7…01): the composite foreign key refuses it on insert and on update.
  perform tests.assert_fails($q$insert into tms.plan_cycles (name_ar, name_en, period_start_on, period_end_on, deadline_on, needs_form_id) values ('دخيل', 'Intruder', private.plan_cycle_today('a0000000-0000-4000-8000-000000000001'), private.plan_cycle_today('a0000000-0000-4000-8000-000000000001') + 300, private.plan_cycle_today('a0000000-0000-4000-8000-000000000001') + 10, 'b7000000-0000-4000-8000-000000000001')$q$,
    array['23503'], 'a new cycle never uses another organization''s form');
  perform tests.assert_fails($q$update tms.plan_cycles set needs_form_id = 'b7000000-0000-4000-8000-000000000001' where id = 'ae000000-0000-4000-8000-000000000001'$q$,
    array['23503'], 'a draft never moves to another organization''s form');
  perform tests.assert_fails($q$update tms.plan_cycles set needs_form_id = gen_random_uuid() where id = 'ae000000-0000-4000-8000-000000000001'$q$,
    array['23503'], 'nor to a form that does not exist');
end $$;
rollback;

-- ---- launch needs a form and locks it ---------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  f constant uuid := 'a7000000-0000-4000-8000-000000000001';
  v_launch text := format($q$update tms.plan_cycles set status = 'open' where id = %L$q$, c);
  v_state text;
  v_message text;
begin
  update tms.plan_cycles set needs_form_id = f where id = c;
  perform tests.assert((select locked_at is null from tms.needs_forms where id = f), 'the form starts unlocked');
  -- A refused launch (Q1: ae…02 is still open) leaves the form unlocked.
  perform tests.assert_fails(v_launch, array['JK002'], 'Q1 refuses the launch');
  perform tests.assert((select locked_at is null from tms.needs_forms where id = f),
    'a refused launch does not lock the form');
  update tms.plan_cycles set status = 'closed' where id = 'ae000000-0000-4000-8000-000000000002';

  -- No form: not ready.
  update tms.plan_cycles set needs_form_id = null where id = c;
  begin
    execute v_launch;
    v_state := '00000';
  exception when others then
    v_state := sqlstate;
    v_message := sqlerrm;
  end;
  perform tests.assert(v_state = 'JK003' and v_message like '%: no_needs_form',
    format('not ready without a needs form (got %s %s)', v_state, v_message));

  update tms.plan_cycles set needs_form_id = f where id = c;
  perform tests.assert_eq(tests.rows_affected(v_launch), 1::bigint, 'launch with the form: draft → open');
  perform tests.assert((select locked_at is not null from tms.needs_forms where id = f),
    'the launch locked the cycle''s form in the same transaction');
  perform tests.assert_fails($q$insert into tms.needs_form_sections (form_id, name_en, name_ar) values ('a7000000-0000-4000-8000-000000000001', 'More', 'المزيد')$q$,
    array['JN001'], 'the locked form''s sections no longer change');
  perform tests.assert_fails($q$delete from tms.needs_forms where id = 'a7000000-0000-4000-8000-000000000001'$q$,
    array['JN001', '23503'], 'the launched cycle''s form is not deleted');
  perform tests.assert_fails(format($q$update tms.plan_cycles set needs_form_id = null where id = %L$q$, c),
    array['JK001'], 'an open cycle keeps its form');
end $$;
rollback;

-- ---- a form a draft cycle uses is not deleted --------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
declare
  v_form uuid := private.duplicate_needs_form('a7000000-0000-4000-8000-000000000001', 'Copy for a draft', 'نسخة لمسودة');
  v_delete text;
begin
  perform tests.assert(v_form is not null, 'the L&D Manager duplicates a form');
  v_delete := format($q$delete from tms.needs_forms where id = %L$q$, v_form);
  update tms.plan_cycles set needs_form_id = v_form where id = 'ae000000-0000-4000-8000-000000000001';
  perform tests.assert_fails(v_delete, array['23503'], 'a form a draft cycle uses cannot be deleted');
  update tms.plan_cycles set needs_form_id = 'a7000000-0000-4000-8000-000000000001'
    where id = 'ae000000-0000-4000-8000-000000000001';
  perform tests.assert_eq(tests.rows_affected(v_delete), 1::bigint, 'once no cycle uses it, it is deleted');
end $$;
rollback;

-- ---- tenant B: its own default form ------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-00000000e0b1',
  'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000ab'));
do $$
declare
  v_id uuid;
begin
  insert into tms.plan_cycles (name_ar, name_en, period_start_on, period_end_on, deadline_on)
    values ('خطة', 'Plan', private.plan_cycle_today('b0000000-0000-4000-8000-000000000001'), private.plan_cycle_today('b0000000-0000-4000-8000-000000000001') + 300, private.plan_cycle_today('b0000000-0000-4000-8000-000000000001') + 10) returning id into v_id;
  perform tests.assert((select c.needs_form_id = f.id and f.tenant_id = 'b0000000-0000-4000-8000-000000000001'::uuid
                        from tms.plan_cycles c join tms.needs_forms f on f.id = c.needs_form_id where c.id = v_id),
    'tenant B''s new cycle gets tenant B''s default form');
  perform tests.assert_fails($q$update tms.plan_cycles set needs_form_id = 'a7000000-0000-4000-8000-000000000001'$q$,
    array['23503'], 'never tenant A''s form');
end $$;
rollback;

\echo '99_planning_c_needs_forms_app_server: ok'
