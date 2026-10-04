-- Tree rules shared by the organization hierarchies (branches, departments — T-M2-01, ADM-04/05).
-- Trigger arguments: (1) the parent column, (2) the maximum number of levels. The table must have
-- `id`, `tenant_id` and `deleted_at`. Rules:
--   * no cycles, at most N levels (a moved row's subtree moves with it);
--   * a row cannot be placed under (or restored under) a soft-deleted parent;
--   * a row cannot be soft-deleted while it has children that are not deleted.
-- Concurrency: hierarchy changes are serialised per table and tenant with a transaction-level advisory
-- lock; the queries after the lock see rows committed meanwhile because each statement takes a fresh
-- snapshot under READ COMMITTED (the isolation level the application uses — this check is NOT safe
-- under REPEATABLE READ / SERIALIZABLE without a retry).
-- SECURITY INVOKER: the walk sees the rows the caller's policies allow. The read policies of the
-- tables using it are tenant-wide today; if they are ever narrowed (scopes), move this check to a
-- definer function with an explicit tenant filter or the rules silently weaken.

create or replace function private.check_tree()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_col constant text := tg_argv[0];
  v_max constant integer := tg_argv[1]::integer;
  v_rel constant text := format('%I.%I', tg_table_schema, tg_table_name);
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_parent uuid := private.try_uuid(v_new ->> v_col);
  v_deleting boolean := tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null;
  v_restoring boolean := tg_op = 'UPDATE' and old.deleted_at is not null and new.deleted_at is null;
  v_moving boolean := tg_op = 'INSERT' or (v_new ->> v_col) is distinct from (v_old ->> v_col);
  v_flag boolean;
  v_depth integer;
  v_below integer := 0;
begin
  -- Own parent: left to the table's `<table>_parent_check` constraint (clearer error, tested by name).
  if not (v_deleting or v_restoring or (v_moving and v_parent is not null)) or v_parent = new.id then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_rel || ':' || new.tenant_id::text, 0));

  if v_deleting then
    execute format('select exists (select 1 from %s where tenant_id = $1 and %I = $2 and deleted_at is null)', v_rel, v_col)
      into v_flag using new.tenant_id, new.id;
    if v_flag then
      raise exception '% row % still has rows under it that are not deleted', v_rel, new.id
        using errcode = 'check_violation';
    end if;
  end if;

  if v_parent is null or new.deleted_at is not null then
    return new;
  end if;

  execute format('select deleted_at is not null from %s where tenant_id = $1 and id = $2', v_rel)
    into v_flag using new.tenant_id, v_parent;
  if v_flag then
    raise exception '% row % cannot be placed under a deleted parent', v_rel, new.id
      using errcode = 'check_violation';
  end if;

  if not v_moving then
    return new;
  end if;

  -- Levels below the row (its subtree moves with it).
  if tg_op = 'UPDATE' then
    execute format($q$
      with recursive descendants (id, depth) as (
        select t.id, 1 from %1$s t where t.tenant_id = $1 and t.%2$I = $2
        union all
        select t.id, s.depth + 1 from descendants s
        join %1$s t on t.tenant_id = $1 and t.%2$I = s.id
        where s.depth < 20
      )
      select coalesce(max(depth), 0) from descendants$q$, v_rel, v_col)
      into v_below using new.tenant_id, new.id;
  end if;

  -- Ancestors of the new parent; reaching the row itself means a cycle.
  execute format($q$
    with recursive ancestors (id, parent_id, depth, cycle) as (
      select t.id, t.%2$I, 1, t.id = $2 from %1$s t where t.tenant_id = $1 and t.id = $3
      union all
      select t.id, t.%2$I, a.depth + 1, t.id = $2 from ancestors a
      join %1$s t on t.tenant_id = $1 and t.id = a.parent_id
      where not a.cycle and a.depth < 20
    )
    select max(depth), coalesce(bool_or(cycle), false) from ancestors$q$, v_rel, v_col)
    into v_depth, v_flag using new.tenant_id, new.id, v_parent;
  if v_flag then
    raise exception '% row % cannot be placed under its own descendant', v_rel, new.id
      using errcode = 'check_violation';
  end if;
  -- ancestors + the row itself + the levels under it.
  if coalesce(v_depth, 0) + 1 + v_below > v_max then
    raise exception '% hierarchy is limited to % levels', v_rel, v_max
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

comment on function private.check_tree() is
  'Keeps an organization hierarchy a tree (no cycles, max levels, no deleted parents). SECURITY INVOKER; serialised per tenant.';

revoke all on function private.check_tree() from public;
