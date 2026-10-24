import type { EmailVariables } from '@jadarat/platform-notifications';

/**
 * The invitation e-mail's variables, built ONE way for both senders: the worker's mailer
 * (jobs/invitation-mailer.ts) and the web app's immediate sending (inline-mail.ts) - so the two can never
 * say different things (WP-ADM-05 follow-up).
 */

/** Shown in the e-mail's expiry date until organizations have their own time-zone setting. */
export const INVITATION_MAIL_TIME_ZONE = 'Asia/Riyadh';

/** Arabic and English name of a system role (`getSystemRole(code).name`, platform-rbac). */
export type RoleNameLookup = (code: string) => { readonly ar: string; readonly en: string };

export interface InvitationMailFacts {
  readonly email: string;
  readonly locale: 'ar' | 'en';
  readonly recipientName: { readonly ar: string; readonly en: string | null };
  readonly inviterName: { readonly ar: string; readonly en: string | null };
  readonly organizationName: { readonly ar: string; readonly en: string | null };
  readonly primaryRole: string;
  /** A custom role's names (the organization named it); null for a standard role. */
  readonly primaryRoleName: { readonly ar: string; readonly en: string } | null;
  readonly expiresAt: Date;
}

/** `base`: the app's public origin without a trailing slash; `code`: the invitation's current code. */
export function invitationEmailVariables(
  facts: InvitationMailFacts,
  code: string,
  base: string,
  roleName: RoleNameLookup,
): EmailVariables<'platform.invitation'> {
  // A custom role is named by the organization (EP-ROLES); a standard role by the catalogue.
  const role = facts.primaryRoleName ?? roleName(facts.primaryRole);
  return {
    recipientName: facts.recipientName,
    inviterName: facts.inviterName,
    organizationName: facts.organizationName,
    roleName: role,
    // The Kawadir sign-up link with the code in the fragment: browsers never send it to the server, so the
    // code stays out of access logs, proxies and Referer headers; the page reads it in the browser (review
    // M3). The same link the inviter can copy.
    acceptUrl: `${base}/${facts.locale}/sign-up#code=${code}`,
    expiresAt: facts.expiresAt.toISOString(),
    timeZone: INVITATION_MAIL_TIME_ZONE,
    loginEmail: facts.email,
  };
}
