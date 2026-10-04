/**
 * Drizzle table definitions for schema `platform` — TYPES for the query builder only.
 * The source of truth is SQL in supabase/migrations (RLS, grants and functions are first-class there).
 * Keep in sync with: 20260930120200_platform__tenancy_core.sql, 20260930120300_platform__audit_events.sql,
 * 20261004120100_platform__create_branches.sql, 20261004120200_platform__create_departments.sql
 */
import {
  boolean,
  char,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const platform = pgSchema('platform');

export const tenantStatus = ['trial', 'active', 'suspended', 'cancelled'] as const;
export const membershipStatus = ['invited', 'active', 'suspended', 'revoked'] as const;
export const orgUnitStatus = ['active', 'inactive'] as const;

export const tenants = platform.table('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  status: text('status', { enum: tenantStatus }).notNull().default('trial'),
  edition: text('edition').notNull().default('standard'),
  mode: text('mode', { enum: ['suite', 'standalone'] })
    .notNull()
    .default('standalone'),
  dataResidency: text('data_residency').notNull().default('eu-central-1'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenantDomains = platform.table('tenant_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  hostname: text('hostname').notNull(),
  kind: text('kind', { enum: ['subdomain', 'custom'] }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const persons = platform.table('persons', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  displayNameAr: text('display_name_ar').notNull(),
  displayNameEn: text('display_name_en'),
  email: text('email'),
  employeeNumber: text('employee_number'),
  status: text('status', { enum: ['active', 'inactive'] })
    .notNull()
    .default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenantMemberships = platform.table('tenant_memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  personId: uuid('person_id').notNull(),
  status: text('status', { enum: membershipStatus }).notNull().default('invited'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Active tenant per Auth session (ADR 0002 §2). Written only via private.switch_active_tenant(). */
export const sessionContext = platform.table('session_context', {
  sessionId: uuid('session_id').primaryKey(),
  userId: uuid('user_id').notNull(),
  activeTenantId: uuid('active_tenant_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = platform.table('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  actorUserId: uuid('actor_user_id'),
  actorPersonId: uuid('actor_person_id'),
  impersonatorUserId: uuid('impersonator_user_id'),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  requestId: text('request_id'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
});

/**
 * [std] + [sd] columns (data model §1.4). created_* / updated_* / version are set by the database
 * trigger private.stamp_row() from the verified claims; values sent by callers are ignored.
 */
const stdColumns = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by'),
});

/** Branches (ADM-04 subset, T-M2-01). */
export const branches = platform.table('branches', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  code: text('code').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  parentBranchId: uuid('parent_branch_id'),
  countryCode: char('country_code', { length: 2 }),
  cityAr: text('city_ar'),
  cityEn: text('city_en'),
  timezone: text('timezone').notNull().default('Asia/Riyadh'),
  isHeadquarters: boolean('is_headquarters').notNull().default(false),
  status: text('status', { enum: orgUnitStatus }).notNull().default('active'),
  ...stdColumns(),
});

/** Departments (ADM-05 subset, T-M2-01): a tree of at most 10 levels (enforced in the database). */
export const departments = platform.table('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  code: text('code').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  parentId: uuid('parent_id'),
  branchId: uuid('branch_id'),
  headPersonId: uuid('head_person_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  status: text('status', { enum: orgUnitStatus }).notNull().default('active'),
  ...stdColumns(),
});
