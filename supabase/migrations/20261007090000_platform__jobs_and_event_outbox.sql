-- Background jobs and domain events (ADR 0004, ADR 0005; T-M2-06a).
--
--   app_queue   LOGIN role of the job runner (graphile-worker) and the event dispatcher. NOT a member of
--               authenticated, NOINHERIT, NOBYPASSRLS. Owns schema graphile_worker and reads/updates only
--               the outbox columns it needs (policies below); no access to any business table.
--               graphile-worker runs its own schema migrations at start-up (`create schema if not exists`,
--               which PostgreSQL authorises with CREATE on the database even when the schema exists), so
--               app_queue holds CREATE on the database — it can create schemas of its own, nothing more.
--   platform.event_outbox   transactional outbox: request and job code insert an event in the same
--               transaction as the business change; the dispatcher (app_queue) fans it out to subscriber
--               jobs. Append-only for application roles.
--   platform.event_inbox    per subscriber and event: written by the delivery job in the same transaction
--               as the handler's work (exactly-once effect, at-least-once delivery).
-- Passwords are set out of band (scripts/db-deploy.sh, APP_QUEUE_DB_PASSWORD), never here.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_queue') then
    create role app_queue login noinherit nobypassrls;
  end if;
end
$$;

-- Same attribute policy as the other login roles (20260930120000): privileged attributes are asserted,
-- the others re-asserted when they differ. app_queue must never be a member of authenticated.
do $$
declare
  r record;
begin
  select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolreplication, rolcreatedb, rolcreaterole
    into r from pg_roles where rolname = 'app_queue';
  if r.rolsuper or r.rolbypassrls or r.rolreplication then
    raise exception 'role app_queue must be NOSUPERUSER NOBYPASSRLS NOREPLICATION; fix it as a superuser first';
  end if;
  if r.rolinherit or r.rolcreatedb or r.rolcreaterole or not r.rolcanlogin then
    alter role app_queue login noinherit nocreatedb nocreaterole;
  end if;
  if pg_has_role('app_queue', 'authenticated', 'MEMBER') then
    raise exception 'role app_queue must not be a member of authenticated';
  end if;
end
$$;

-- The migration role hands schema and function ownership to app_queue.
grant app_queue to current_user;

create schema if not exists graphile_worker authorization app_queue;
revoke all on schema graphile_worker from public;
comment on schema graphile_worker is
  'graphile-worker job queue (ADR 0005), owned by app_queue. Infrastructure: no tenant data, never exposed through the Data API.';

do $$
begin
  execute format('grant create on database %I to app_queue', current_database());
  -- Without the grant option GRANT only warns: fail here rather than at the worker's first start.
  if not has_database_privilege('app_queue', current_database(), 'CREATE') then
    raise exception 'could not grant CREATE on database % to app_queue (the migration role needs the grant option)', current_database();
  end if;
end
$$;

grant usage on schema platform, private to app_queue;

-- ---------------------------------------------------------------------------------------------------
-- Outbox
-- ---------------------------------------------------------------------------------------------------
create table platform.event_outbox (
  id uuid primary key default gen_random_uuid(),
  position bigint generated always as identity,
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  type text not null,
  schema_version smallint not null default 1,
  subject uuid,
  -- Thin events: identifiers and changed facts, never names, e-mail addresses or phone numbers.
  data jsonb not null default '{}'::jsonb,
  actor_type text not null,
  actor_id uuid,
  correlation_id text,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  unique (position),
  constraint event_outbox_type_check
    check (type ~ '^com\.entlaqa\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' and char_length(type) <= 200),
  constraint event_outbox_version_check check (schema_version between 1 and 999),
  constraint event_outbox_actor_check check (actor_type in ('user', 'system', 'platform')),
  constraint event_outbox_data_check check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 16384),
  constraint event_outbox_correlation_check check (correlation_id is null or char_length(correlation_id) <= 100)
);
comment on table platform.event_outbox is
  'Transactional outbox (ADR 0004). Owner: platform. Append-only for application roles; dispatched by app_queue. Retained 90 days after dispatch (housekeeping job).';

create index event_outbox_pending_idx on platform.event_outbox (position) where dispatched_at is null;

-- Actor fields come from the verified claims of the inserting transaction, never from the caller.
create or replace function private.stamp_event_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text := private.request_claims() ->> 'role';
begin
  new.created_at := now();
  new.dispatched_at := null;
  if current_user <> 'authenticated' then
    new.actor_type := 'platform';  -- migrations, provisioning: no user claims
    new.actor_id := null;
  elsif v_kind = 'system' then
    new.actor_type := 'system';
    new.actor_id := null;
  else
    new.actor_type := 'user';
    new.actor_id := private.request_user_id();
  end if;
  return new;
end
$$;
revoke all on function private.stamp_event_actor() from public;

create trigger event_outbox_stamp before insert on platform.event_outbox
  for each row execute function private.stamp_event_actor();

alter table platform.event_outbox enable row level security;
alter table platform.event_outbox force row level security;

create policy tenant_isolation on platform.event_outbox
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy event_outbox_insert on platform.event_outbox for insert to authenticated with check (true);
-- The dispatcher reads pending events and marks them dispatched (column grant below).
create policy event_outbox_dispatch_read on platform.event_outbox for select to app_queue using (true);
create policy event_outbox_dispatch_mark on platform.event_outbox for update to app_queue
  using (dispatched_at is null) with check (dispatched_at is not null);

revoke all on platform.event_outbox from public, anon;
grant insert on platform.event_outbox to authenticated;
grant select on platform.event_outbox to app_queue;
grant update (dispatched_at) on platform.event_outbox to app_queue;

-- ---------------------------------------------------------------------------------------------------
-- Inbox
-- ---------------------------------------------------------------------------------------------------
create table platform.event_inbox (
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  subscriber text not null,
  event_id uuid not null,
  processed_at timestamptz not null default now(),
  primary key (tenant_id, subscriber, event_id),
  constraint event_inbox_subscriber_check check (subscriber ~ '^[a-z][a-z0-9_.@-]{0,99}$')
);
comment on table platform.event_inbox is
  'Processed events per subscriber (ADR 0004 §5): written by delivery jobs only (system claims). Owner: platform.';

alter table platform.event_inbox enable row level security;
alter table platform.event_inbox force row level security;

create policy tenant_isolation on platform.event_inbox
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Only jobs (system claims under app_worker) record or read processed events; user requests never do.
create policy event_inbox_jobs on platform.event_inbox for all to authenticated
  using ((select private.request_claims() ->> 'role') = 'system')
  with check ((select private.request_claims() ->> 'role') = 'system');

revoke all on platform.event_inbox from public, anon;
grant select, insert on platform.event_inbox to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Dispatcher kick
-- ---------------------------------------------------------------------------------------------------
-- After a transaction first inserts events, add one dispatch job (visible to workers only after the
-- business transaction commits, so it always sees that transaction's events). The job has no job_key:
-- a keyed add_job upserts one shared row and would hold its lock until commit, making every
-- event-writing transaction wait for the others (and risking deadlocks). Dispatch jobs share a named
-- queue, so they run one at a time. When graphile-worker has not installed its schema yet (no worker has
-- started), nothing is added: the dispatcher's own schedule picks the events up later.
create or replace function private.kick_event_dispatcher()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('jadarat.event_dispatch_kicked', true), '') <> 'on'
     and to_regprocedure('graphile_worker.add_job(text,json,text,timestamp with time zone,integer,text,integer,text[],text)') is not null then
    execute $sql$select graphile_worker.add_job('platform.events.dispatch', '{}'::json,
      queue_name := 'platform.events.dispatch', max_attempts := 25)$sql$;
    -- Once per transaction (reverted with the job if a savepoint rolls back).
    perform set_config('jadarat.event_dispatch_kicked', 'on', true);
  end if;
  return null;
end
$$;
comment on function private.kick_event_dispatcher() is
  'SECURITY DEFINER (owner app_queue): adds one outbox dispatch job per transaction that inserts events (ADR 0004 §4).';
revoke all on function private.kick_event_dispatcher() from public;

-- ALTER OWNER needs CREATE on the schema for the new owner: granted for this statement only.
grant create on schema private to app_queue;
alter function private.kick_event_dispatcher() owner to app_queue;
revoke create on schema private from app_queue;

create trigger event_outbox_kick after insert on platform.event_outbox
  for each statement execute function private.kick_event_dispatcher();
