import { createHash, randomBytes } from 'node:crypto';
import {
  invitationActorMayManage,
  issueInvitationToken,
  loadInvitationForMail,
} from '@jadarat/platform-db/jobs';
import type { TransactionalSubscriber, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { isSafeLink } from '@jadarat/platform-notifications';
import { queueEmail } from '@jadarat/platform-notifications/jobs';

export const INVITATION_MAILER_NAME = 'platform.invitations.mailer';
export const INVITATION_CREATED_EVENT = 'com.entlaqa.platform.invitation.created';
export const INVITATION_RESEND_REQUESTED_EVENT = 'com.entlaqa.platform.invitation.resend_requested';
/** First e-mail plus three resends (invitations contract §1 step 3). */
export const INVITATION_MAX_SENDS = 4;
/**
 * Database work only (load, store the token hash, queue the e-mail), so a failure is the database's:
 * about 3.5 hours of retries (graphile-worker waits e^n seconds after the n-th failure) ride out an
 * outage, as for the e-mail sender.
 */
export const INVITATION_MAILER_MAX_ATTEMPTS = 10;
/** Shown in the e-mail's expiry date until organizations have their own time-zone setting. */
const TIME_ZONE = 'Asia/Riyadh';

/** Arabic and English name of a system role (`getSystemRole(code).name`, platform-rbac). */
export type RoleNameLookup = (code: string) => { readonly ar: string; readonly en: string };

export interface InvitationMailerOptions {
  /** Public origin of the web app, e.g. `https://tms.example.com` (worker setting APP_BASE_URL). */
  readonly appBaseUrl: string;
  /**
   * Role names come from platform-rbac, which depends on this package: the worker passes
   * `(code) => getSystemRole(code).name` instead of this package importing it (no package cycle).
   */
  readonly roleName: RoleNameLookup;
  readonly log: (level: WorkerLogLevel, message: string) => void;
}

/** SHA-256 of the token's UTF-8 bytes: the only form the database keeps (contract §1 step 2). */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * Invitation e-mail (FR-IAM-03, T-M2-07; invitations contract §1 step 2, §3). For each invitation
 * created or resend requested, in the invitation's tenant transaction: issue a new random token (32
 * bytes, base64url) whose SHA-256 replaces the stored one — older links stop working — and queue the
 * bilingual invitation e-mail carrying the accept link (token in the URL fragment). The raw token exists
 * only in the queued e-mail. An event that does not come from a member who may still manage the
 * invitation, or an invitation no longer pending or at its send limit, is skipped without error. Logs
 * never carry names, addresses or tokens.
 */
export function createInvitationMailer(options: InvitationMailerOptions): TransactionalSubscriber {
  let base = options.appBaseUrl;
  // Trailing slashes trimmed without a backtracking regular expression (CodeQL js/polynomial-redos).
  while (base.endsWith('/')) base = base.slice(0, -1);
  if (!isSafeLink(base)) {
    throw new Error('invitation mailer: the app base URL must be https (http only for localhost)');
  }
  const { log, roleName } = options;
  return {
    name: INVITATION_MAILER_NAME,
    types: [INVITATION_CREATED_EVENT, INVITATION_RESEND_REQUESTED_EVENT],
    maxAttempts: INVITATION_MAILER_MAX_ATTEMPTS,
    async handle({ tx, event }) {
      const id = event.subject;
      if (!id) {
        log('warning', 'invitation event without subject; ignored');
        return;
      }
      // Invitations and resend requests come from members (user events). The mailer acts only while
      // that member still may manage this invitation — current roles, privileged roles by an
      // Organization Admin (security review M2): a revoked, suspended or demoted member's request
      // sends nothing.
      if (event.actorType !== 'user' || !event.actorId) {
        log('warning', 'invitation event not from a member; ignored');
        return;
      }
      if (!(await invitationActorMayManage(tx, id, event.actorId))) {
        log('warning', 'invitation event from a member who may no longer manage it; no e-mail');
        return;
      }
      const invitation = await loadInvitationForMail(tx, id);
      if (invitation?.status !== 'pending' || invitation.sendCount >= INVITATION_MAX_SENDS) {
        log('info', 'invitation not pending or send limit reached; no e-mail');
        return;
      }
      const role = roleName(invitation.primaryRole);
      const token = randomBytes(32).toString('base64url');
      const issued = await issueInvitationToken(tx, invitation.id, hashToken(token));
      if (!issued) {
        log('info', 'invitation not pending or send limit reached; no e-mail');
        return;
      }
      const { locale } = invitation;
      await queueEmail(tx, {
        template: 'platform.invitation',
        locale,
        to: invitation.email,
        recipientPersonId: invitation.personId,
        sourceEventId: event.id,
        variables: {
          recipientName: invitation.recipientName,
          inviterName: invitation.inviterName,
          organizationName: invitation.organizationName,
          roleName: role,
          // In the fragment: browsers never send it to the server, so the token stays out of access
          // logs, proxies and Referer headers; the page reads it in the browser (review M3).
          acceptUrl: `${base}/${locale}/invite/accept#token=${token}`,
          expiresAt: issued.expiresAt.toISOString(),
          timeZone: TIME_ZONE,
          loginEmail: invitation.email,
        },
      });
      log('info', 'invitation e-mail queued');
    },
  };
}
