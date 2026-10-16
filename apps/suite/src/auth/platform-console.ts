'use server';
/**
 * The Platform Super Admin console «مشرف المنصة» (FR-ADM-17; ADR 0013). Public actions because a Super
 * Admin's session has NO organization (defineAction requires a tenant claim): every check is in
 * @jadarat/platform-identity (platform-console.ts) — the session verified on the server with Auth (getUser)
 * and the database's decision that the user is a Super Admin (and again inside every database function).
 * Anyone else gets NOT_FOUND, whatever they send: the input is parsed only AFTER that check (security
 * review L6). Codes go to the Super Admin's browser only (copy code / copy link), with the link on the app's
 * canonical origin (APP_BASE_URL; null → the browser's own); they are never logged or audited.
 */
import { type AppError, type Result, ok, parseInput } from '@jadarat/platform-core';
import {
  createOrganizationFromConsoleForRequest,
  reissueOrganizationAdminCodeForRequest,
  viewOrganizationAdminCodeForRequest,
} from '@jadarat/platform-identity/auth';
import { definePublicAction } from '@jadarat/platform-rbac';
import { z } from 'zod';
import { canonicalInviteLink } from '../lib/app-base-url-request';
import { CreateOrganizationInput, OrganizationRefInput } from '../lib/platform-console-input';

/** Untrusted: validated by the handler after the access check (review L6). */
const Unvalidated = z.unknown();

const organizationRef = (raw: unknown): Result<string, AppError> => {
  const parsed = parseInput(OrganizationRefInput, raw);
  return parsed.ok ? ok(parsed.value.tenantId) : parsed;
};

function withLink<T extends { readonly inviteCode: string; readonly locale: 'ar' | 'en' }>(
  result: Result<T, AppError>,
): Result<T & { readonly inviteLink: string | null }, AppError> {
  return result.ok
    ? ok({
        ...result.value,
        inviteLink: canonicalInviteLink(result.value.locale, result.value.inviteCode),
      })
    : result;
}

/** «إنشاء منظمة» / Create organization: the organization and its Organization Admin's invitation code. */
export const createOrganizationAction = definePublicAction({
  name: 'platform.console.create_organization',
  input: Unvalidated,
  handler: async ({ input }) =>
    withLink(
      await createOrganizationFromConsoleForRequest(input, (raw) =>
        parseInput(CreateOrganizationInput, raw),
      ),
    ),
});

/** Copy the pending Organization Admin's code or link (an audited read). */
export const viewOrganizationAdminCodeAction = definePublicAction({
  name: 'platform.console.view_admin_code',
  input: Unvalidated,
  handler: async ({ input }) =>
    withLink(await viewOrganizationAdminCodeForRequest(input, organizationRef)),
});

/** «رمز جديد» / New code for the pending Organization Admin (the old link stops working). */
export const reissueOrganizationAdminCodeAction = definePublicAction({
  name: 'platform.console.reissue_admin_code',
  input: Unvalidated,
  handler: async ({ input }) =>
    withLink(await reissueOrganizationAdminCodeForRequest(input, organizationRef)),
});
