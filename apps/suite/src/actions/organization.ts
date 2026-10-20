'use server';
/**
 * Organization profile and regional settings (FR-ADM-02, FR-SCH-07; T-M2-22) and Branding (WP-ADM-02,
 * FR-ADM-07). Definitions and tests in @jadarat/platform-rbac (iam/organization-profile.ts, iam/branding.ts);
 * the database enforces the rules.
 */
import {
  confirmBrandImageUploadActionDefinition,
  defineAction,
  saveBrandingActionDefinition,
  startBrandImageUploadActionDefinition,
  updateOrganizationProfileActionDefinition,
} from '@jadarat/platform-rbac';
import { revalidatePath } from 'next/cache';
import { brandingFiles, readBrandingImage } from '../lib/branding-files';
import { deriveBrandingColors } from '../lib/branding-view';

/** Organization Admin at AAL2 only (platform.tenant.manage: high risk, getUser + a recent code). */
export const updateOrganizationProfileAction = defineAction(
  updateOrganizationProfileActionDefinition(),
);

const saveBrandingDefinition = saveBrandingActionDefinition(
  deriveBrandingColors,
  readBrandingImage,
);

/**
 * Branding → Save: the Organization Admin only (platform.tenant.manage). New images are checked and
 * published with the save (not virus-scanned: PO, 20 Oct 2026). Afterwards every page of the organization
 * renders with the new look at once (the layout's cache is dropped).
 */
export const saveBrandingAction = defineAction({
  ...saveBrandingDefinition,
  afterCommit: ({ result }) => {
    if (result.changed.length > 0) revalidatePath('/', 'layout');
    return Promise.resolve({ ok: true as const, value: result });
  },
});

/** Branding → an image: the upload reserved, then the signed URL for the browser's PUT. */
export const startBrandImageUploadAction = defineAction(
  startBrandImageUploadActionDefinition(brandingFiles),
);

/** Branding → an image, after the PUT: confirmed (checked and published when the Branding is saved). */
export const confirmBrandImageUploadAction = defineAction(
  confirmBrandImageUploadActionDefinition(brandingFiles),
);
