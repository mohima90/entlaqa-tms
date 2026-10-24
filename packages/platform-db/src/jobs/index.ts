/**
 * RESTRICTED ENTRY POINT — background jobs only (ADR 0002 §7, ADR 0005).
 * Allowed importers: code under **\/jobs/** (dependency-cruiser rule `jobs-db-only-in-jobs`).
 *
 * withSystemTx connects as login role `app_worker` and sets a system-actor claim set for exactly one
 * tenant; RLS applies (private.current_tenant_id() accepts system claims only under app_worker).
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type ClaimsTx, runWithClaims } from '../claims-tx';

export {
  type BrandAssetWork,
  type BrandImageSource,
  type EmailBrand,
  claimBrandAssetWork,
  forgetBrandingDeployedForTests,
  getEmailBrand,
  loadBrandImageSource,
  noteBrandAssetFailure,
  publishBrandAsset,
} from './branding';
// Branding images without a malware scan: the same database call as the web app's (job's tenant claims).
export { type BrandImagePublication, publishBrandImage } from '../branding';
export {
  type ClaimedEmail,
  type DeliveryOutcome,
  type QueuedEmail,
  CLAIM_LEASE_SECONDS,
  claimEmailDelivery,
  discardInactiveTenantDelivery,
  finishEmailDelivery,
  getEmailDeliveryTemplate,
  inlineDeliveryExists,
  insertEmailDelivery,
  listTenantsToRescueInline,
  takeInlineRescue,
} from './deliveries';
export {
  EMAIL_WAITING_CODES,
  type EmailRouteRow,
  type EmailTestClaim,
  claimEmailTests,
  finishEmailTest,
  isEmailSettingsMissing,
  listTenantsWaitingForSender,
  loadEmailRoute,
  noteInvitationMailSkipped,
  publishEmailCredentialsKey,
  sweepEmailDeliveries,
  takeWaitingDeliveries,
} from './email';
export {
  ACCOUNT_MAIL_KINDS,
  ACCOUNT_MAIL_MAX_ATTEMPTS,
  type AccountMailContext,
  type AccountMailKind,
  type AccountMailRequest,
  type AccountMailSkip,
  DIGESTED_KINDS,
  type DigestedKind,
  type SecurityDigest,
  MFA_REMOVAL_REASONS,
  type MfaFactorTokens,
  type MfaRemovalReason,
  type PolicyChange,
  accountHasApp,
  accountNeedsPlatformSender,
  claimAccountMailRequest,
  finishAccountMailRequest,
  issueMfaFactorTokens,
  loadAccountMailContext,
  purgeEndedSessions,
  purgeUnconfirmedMfaApps,
  loadPersonName,
  retryAccountMailRequest,
} from './account-mail';
export { expireTrials } from '../plans';
export {
  type GeneratedFileInput,
  type HousekeepingAction,
  type HousekeepingItem,
  type OrphanBatch,
  type OrphanObject,
  type ScanLease,
  type ScanOutcome,
  claimFileHousekeeping,
  claimFileScan,
  claimOrphanObjects,
  createGeneratedFile,
  finishFileHousekeeping,
  finishFileScan,
  finishGeneratedFile,
  insertSystemAuditEvent,
  loadCleanFile,
  lockFileHousekeeping,
  retryFileScan,
} from './files';
export {
  type InvitationForMail,
  invitationActorMayManage,
  invitationCodeForMail,
  loadInvitationForMail,
} from './invitations';
export {
  IMPORTER_NOT_ALLOWED,
  type InvitationSending,
  type ReleaseState,
  type ReportSourceRow,
  type StagedColumn,
  type StagedRow,
  type StatusChange,
  type UserImportClaim,
  type UserImportJobView,
  type UserImportStep,
  applyUserImportBatch,
  classifyUserImport,
  claimUserImportWork,
  clearUserImportSchedule,
  deleteUserImportStaged,
  finishUserImportRows,
  jobFileStatus,
  loadUserImportForJob,
  loadMemberNamesByEmail,
  loadUserImportHeaders,
  loadUserImportReportRows,
  markUserImportPurged,
  recheckUserImport,
  releaseNextUserImportInvitation,
  noteUserImportLeaseLost,
  releaseUserImportLease,
  renewUserImportLease,
  saveUserImportColumns,
  scheduleUserImportInvitations,
  setUserImportStatus,
  stageUserImportRows,
  undoUserImportBatch,
  userImportReviewCounts,
  userImportUndoCounts,
} from './user-imports';
import { type AppDatabase, getDatabase } from '../client';

export type SystemTx = ClaimsTx;

export interface SystemActor {
  readonly tenantId: string;
  /** Job/task identifier, e.g. `notifications.dispatch:<job uuid>`; recorded for audit. */
  readonly jobId: string;
}

const SystemActorSchema = z.object({
  tenantId: z.uuid(),
  jobId: z.string().trim().min(1).max(200),
});

export type WithSystemTx = <T>(actor: SystemActor, fn: (tx: SystemTx) => Promise<T>) => Promise<T>;

/** System-actor claims (ADR 0002 §6a/§7): role `system`, tenant_id, job_id. No user subject. */
export function systemClaims(actor: SystemActor): {
  role: 'system';
  tenant_id: string;
  job_id: string;
} {
  const parsed = SystemActorSchema.safeParse(actor);
  if (!parsed.success) throw new Error('withSystemTx: invalid system actor');
  return { role: 'system', tenant_id: parsed.data.tenantId, job_id: parsed.data.jobId };
}

export function createWithSystemTx(getDb: () => AppDatabase): WithSystemTx {
  return async function withSystemTx<T>(actor: SystemActor, fn: (tx: SystemTx) => Promise<T>) {
    const claims = systemClaims(actor);
    return runWithClaims(getDb(), JSON.stringify(claims), fn);
  };
}

/** Runs `fn` for one tenant as a system actor (connection role app_worker), with RLS enforced. */
export const withSystemTx: WithSystemTx = createWithSystemTx(() => getDatabase('app_worker'));

/**
 * A job transaction that belongs to no tenant (yet): system-actor claims WITHOUT a tenant (`role:
 * 'system'`, job_id). RLS shows no tenant data (private.current_tenant_id() is NULL); only platform-level
 * definer functions that check for a job under the app_worker login answer — e.g. the account e-mail
 * queue (T-M2-17), whose requests have no organization until the worker resolves one.
 */
export type WithPlatformTx = <T>(
  actor: { readonly jobId: string },
  fn: (tx: SystemTx) => Promise<T>,
) => Promise<T>;

export function createWithPlatformTx(getDb: () => AppDatabase): WithPlatformTx {
  return async function withPlatformTx<T>(
    actor: { readonly jobId: string },
    fn: (tx: SystemTx) => Promise<T>,
  ) {
    const jobId = z.string().trim().min(1).max(200).safeParse(actor.jobId);
    if (!jobId.success) throw new Error('withPlatformTx: invalid job id');
    return runWithClaims(getDb(), JSON.stringify({ role: 'system', job_id: jobId.data }), fn);
  };
}

export const withPlatformTx: WithPlatformTx = createWithPlatformTx(() => getDatabase('app_worker'));

/**
 * Records that `subscriber` processed `eventId` (platform.event_inbox, ADR 0004 §5), in the job's own
 * transaction. False when it was already recorded: the delivery was a retry or a duplicate and the
 * handler must not run again. Only jobs can write the inbox (system claims; the inbox policy enforces it).
 */
export async function markEventProcessed(
  tx: SystemTx,
  subscriber: string,
  eventId: string,
): Promise<boolean> {
  const rows = await tx.execute<{ event_id: string }>(sql`
    insert into platform.event_inbox (subscriber, event_id) values (${subscriber}, ${eventId}::uuid)
    on conflict do nothing returning event_id`);
  return rows.length > 0;
}

/**
 * True when the transaction's tenant may be served (active or trial, ADR 0002 §6a). For a suspended or
 * closed organization the claims resolve to no tenant and RLS shows nothing: jobs skip their work
 * (ADR 0005 §4).
 */
export async function tenantIsServed(tx: SystemTx): Promise<boolean> {
  const [row] = await tx.execute<{ served: boolean }>(
    sql`select private.current_tenant_id() is not null as served`,
  );
  return row?.served === true;
}
