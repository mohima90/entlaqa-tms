import { createHash } from 'node:crypto';
import {
  invitationActorMayManage,
  invitationCodeForMail,
  loadInvitationForMail,
  noteInvitationMailSkipped,
} from '@jadarat/platform-db/jobs';
import type { TransactionalSubscriber, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { isSafeLink } from '@jadarat/platform-notifications';
import { queueEmail } from '@jadarat/platform-notifications/jobs';

export const INVITATION_MAILER_NAME = 'platform.invitations.mailer';
export const INVITATION_CREATED_EVENT = 'com.entlaqa.platform.invitation.created';
export const INVITATION_RESEND_REQUESTED_EVENT = 'com.entlaqa.platform.invitation.resend_requested';
/**
 * A held invitation of a user import whose sending time came (T-M2-12): released by the import's worker
 * task (system actor) — mailed for the member who asked to send it from the users list, else for the
 * importer (integration review M2), while that member may still manage it.
 */
export const INVITATION_RELEASED_EVENT = 'com.entlaqa.platform.invitation.released';
/** First code plus three new ones (invitations contract §1 step 3): the database counts them. */
export const INVITATION_MAX_SENDS = 4;
/**
 * Database work only (load, read the code, queue the e-mail), so a failure is the database's:
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

/** SHA-256 of a token's UTF-8 bytes (the account mailer's links; invitation codes are hashed alike). */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * Invitation e-mail (FR-IAM-03, T-M2-07; invitations contract §1 step 2, §3; codes: PO decision 16 Oct
 * 2026, Kawadir). E-mail is optional: the member who invited can always copy the code or the link. For
 * each invitation created, resent (a new code) or released (an import's), in the invitation's tenant
 * transaction: read the invitation's CURRENT code — issued by the database, which also counted it and gave
 * it 7 days — and queue the bilingual invitation e-mail carrying the sign-up link with that code (in the URL
 * fragment). The mailer issues no token and changes nothing. An event that does not come from a member who
 * may still manage the invitation, or an invitation no longer pending, held or without a code (a link
 * e-mailed before codes), is skipped without error. Logs never carry names, addresses or codes.
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
    types: [INVITATION_CREATED_EVENT, INVITATION_RESEND_REQUESTED_EVENT, INVITATION_RELEASED_EVENT],
    maxAttempts: INVITATION_MAILER_MAX_ATTEMPTS,
    async handle({ tx, event }) {
      const id = event.subject;
      if (!id) {
        log('warning', 'invitation event without subject; ignored');
        return;
      }
      // Invitations and resend requests come from members (user events); released invitations of a user
      // import from its worker task (system events), on behalf of the member who asked to send them, else
      // the importer, who invited (integration review M2). The mailer acts only while that member still
      // may manage this invitation — current roles, privileged roles by an Organization Admin (security
      // review M2): a revoked, suspended or demoted member's request sends nothing.
      const released = event.type === INVITATION_RELEASED_EVENT;
      if (released && event.actorType !== 'system') {
        log('warning', 'invitation release not from the import task; ignored');
        return;
      }
      if (!released && (event.actorType !== 'user' || !event.actorId)) {
        log('warning', 'invitation event not from a member; ignored');
        return;
      }
      // A release acts for the member who asked to send it, else the importer (the inviter); a member's
      // event for that member.
      const releasedInvitation = released ? await loadInvitationForMail(tx, id) : null;
      const actor = released
        ? (releasedInvitation?.sendRequestedBy ?? releasedInvitation?.invitedBy)
        : event.actorId;
      if (!actor || !(await invitationActorMayManage(tx, id, actor))) {
        // T-M2-20: the users list must not show this code as e-mailed — it says «لم تُرسل الدعوة» / "Not
        // sent" until a member who may manage it sends a new code.
        await noteInvitationMailSkipped(tx, id);
        log('warning', 'invitation event from a member who may no longer manage it; no e-mail');
        return;
      }
      const invitation = releasedInvitation ?? (await loadInvitationForMail(tx, id));
      if (invitation?.status !== 'pending') {
        log('info', 'invitation not pending; no e-mail');
        return;
      }
      if (invitation.mailHeld) {
        log('info', 'invitation not sent yet (held); no e-mail');
        return;
      }
      // A custom role is named by the organization (EP-ROLES); a standard role by the catalogue.
      const role = invitation.primaryRoleName ?? roleName(invitation.primaryRole);
      const code = await invitationCodeForMail(tx, invitation.id);
      if (!code) {
        log('info', 'invitation has no code; no e-mail');
        return;
      }
      const { locale } = invitation;
      await queueEmail(tx, {
        template: 'platform.invitation',
        locale,
        to: invitation.email,
        recipientPersonId: invitation.personId,
        sourceEventId: event.id,
        // The organization's logo is linked from the app's origin (WP-ADM-02, FR-NTF-02).
        appBaseUrl: base,
        variables: {
          recipientName: invitation.recipientName,
          inviterName: invitation.inviterName,
          organizationName: invitation.organizationName,
          roleName: role,
          // The Kawadir sign-up link with the code in the fragment: browsers never send it to the server,
          // so the code stays out of access logs, proxies and Referer headers; the page reads it in the
          // browser (review M3). The same link the inviter can copy.
          acceptUrl: `${base}/${locale}/sign-up#code=${code}`,
          expiresAt: invitation.expiresAt.toISOString(),
          timeZone: TIME_ZONE,
          loginEmail: invitation.email,
        },
      });
      log('info', 'invitation e-mail queued');
    },
  };
}
