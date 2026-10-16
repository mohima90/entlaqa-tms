'use server';
/**
 * The Platform Super Admin console «مشرف المنصة» (FR-ADM-17; ADR 0013). Public actions because a Super
 * Admin's session has NO organization (defineAction requires a tenant claim): every check is in
 * @jadarat/platform-identity (platform-console.ts) — the session verified on the server with Auth (getUser)
 * and the database's decision that the user is a Super Admin (and again inside every database function).
 * Anyone else gets NOT_FOUND. These actions only validate input. Codes go to the Super Admin's browser only
 * (copy code / copy link); they are never logged or audited.
 */
import {
  createOrganizationFromConsoleForRequest,
  reissueOrganizationAdminCodeForRequest,
  viewOrganizationAdminCodeForRequest,
} from '@jadarat/platform-identity/auth';
import { definePublicAction } from '@jadarat/platform-rbac';
import { CreateOrganizationInput, OrganizationRefInput } from '../lib/platform-console-input';

/** «إنشاء منظمة» / Create organization: the organization and its Organization Admin's invitation code. */
export const createOrganizationAction = definePublicAction({
  name: 'platform.console.create_organization',
  input: CreateOrganizationInput,
  handler: ({ input }) => createOrganizationFromConsoleForRequest(input),
});

/** Copy the pending Organization Admin's code or link (an audited read). */
export const viewOrganizationAdminCodeAction = definePublicAction({
  name: 'platform.console.view_admin_code',
  input: OrganizationRefInput,
  handler: ({ input }) => viewOrganizationAdminCodeForRequest(input.tenantId),
});

/** «رمز جديد» / New code for the pending Organization Admin (the old link stops working). */
export const reissueOrganizationAdminCodeAction = definePublicAction({
  name: 'platform.console.reissue_admin_code',
  input: OrganizationRefInput,
  handler: ({ input }) => reissueOrganizationAdminCodeForRequest(input.tenantId),
});
