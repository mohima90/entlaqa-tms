-- Background jobs and domain events (ADR 0004, ADR 0005; T-M2-06a).
--
--   app_queue   LOGIN role of the job runner (graphile-worker) and the event dispatcher. NOT a member of
--               authenticated, NOINHERIT, NOBYPASSRLS, no privilege on the database itself. Owns schema
--               graphile_worker (graphile-worker installs its tables there at start-up) and reads/updates
--               only the outbox columns it needs (policies below); no access to any business table. It owns
--               nothing outside its schema, so none of its code ever runs inside request or job
--               transactions.
--   platform.event_outbox   transactional outbox: request and job code insert an event in the same
--               transaction as the business change; the dispatcher (app_queue) fans it out to subscriber
--               jobs. Append-only for application roles. Inserts wake the workers with a notification.
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

-- The migration role hands the schema and its bootstrap table to app_queue.
grant app_queue to current_user;

create schema if not exists graphile_worker authorization app_queue;
revoke all on schema graphile_worker from public;
comment on schema graphile_worker is
  'graphile-worker job queue (ADR 0005), owned by app_queue. Infrastructure: no tenant data, never exposed through the Data API.';

-- graphile-worker (0.18) runs `create schema if not exists` — which PostgreSQL authorises only with CREATE
-- on the database — when its migrations table is missing. The table is created here, exactly as
-- graphile-worker bootstraps it, so the worker installs everything else inside its own schema and
-- app_queue needs no database privilege (with CREATE it could add schemas named after other roles and
-- capture their unqualified names).
set role app_queue;
create table if not exists graphile_worker.migrations (
  id int primary key,
  ts timestamptz default now() not null,
  breaking boolean not null default false
);
reset role;

grant usage on schema platform to app_queue;

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
  -- System actor: the job that wrote the event (ADR 0005 §4), e.g. `platform.events.deliver:42`.
  actor_job text,
  correlation_id text,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  unique (position),
  constraint event_outbox_type_check
    check (type ~ '^com\.entlaqa\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' and char_length(type) <= 200),
  constraint event_outbox_version_check check (schema_version between 1 and 999),
  constraint event_outbox_actor_check check (actor_type in ('user', 'system', 'platform')),
  constraint event_outbox_actor_job_check check (actor_job is null or char_length(actor_job) <= 200),
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
  new.actor_id := null;
  new.actor_job := null;
  if current_user <> 'authenticated' then
    new.actor_type := 'platform';  -- migrations, provisioning: no user claims
  elsif v_kind = 'system' then
    new.actor_type := 'system';
    new.actor_job := left(private.request_claims() ->> 'job_id', 200);
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
-- Dispatcher wake-up
-- ---------------------------------------------------------------------------------------------------
-- After a statement inserts events, notify channel `jadarat_events`. PostgreSQL delivers notifications
-- only when the transaction commits, and merges identical ones of a transaction, so a rolled-back change
-- wakes nobody and a busy transaction sends one. Workers in daemon mode listen and queue a dispatch; the
-- minutely schedule covers any gap (no worker listening, a lost connection). The function runs as the
-- inserting role and touches nothing else: no queue code runs inside business transactions, and their
-- commits never wait on the queue.
create or replace function private.notify_event_dispatcher()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_notify('jadarat_events', '');
  return null;
end
$$;
comment on function private.notify_event_dispatcher() is
  'Wakes the event dispatcher (channel jadarat_events) when a transaction that inserted events commits (ADR 0004 §4).';
revoke all on function private.notify_event_dispatcher() from public;

create trigger event_outbox_notify after insert on platform.event_outbox
  for each statement execute function private.notify_event_dispatcher();
