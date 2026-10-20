import { type AppError, type Result, appError, err, ok } from '@jadarat/platform-core';
import {
  BRAND_IMAGE_KINDS,
  type BrandImageKind,
  type BrandingField,
  type BrandingRecord,
  type BrandingSettings,
  type FileOwner,
  type FileStatusView,
  type UserTx,
  changedBrandingFields,
  getBranding,
  saveBranding,
} from '@jadarat/platform-db';
import { z } from 'zod';
import type { ActionDefinition } from '../define-action';
import type { QueryDefinition } from '../define-query';
import { platformPermissions as p } from '../platform-permissions';
import { OrganizationNameInput } from './organization-profile';

/**
 * Branding (WP-ADM-02, FR-ADM-07, FR-ADM-02 names, FR-NTF-02 e-mail look; business flow EP-BRAND, agreed
 * 20 Oct 2026; Kawadir /org/branding). The database enforces who may change it and every rule
 * (platform.tenant_branding, its image trigger, platform.tenants' names); these definitions authorize,
 * validate and audit.
 *
 *   - The page: members who read the organization's settings organization-wide (`platform.tenant.read`) —
 *     the Organization Admin edits, an Auditor reads; HR Manager, L&D Manager, Learner… are refused.
 *   - Saving, uploading an image: `platform.tenant.manage` — the Organization Admin only (organization-wide,
 *     high risk: the session is confirmed with Auth; never in custom roles — catalogue rule
 *     `organization_only`). Audited before → after (images by file id, never their content; BR-BRD-a).
 *   - Images go through platform-files (purposes platform.brand_*: PNG/JPEG/WebP, 2 MB / 500 KB / 5 MB,
 *     scanned); the app binds the file service (BrandingFileService) — this package does not depend on it.
 *   - Colours: the app derives what is stored and the e-mail colours with the theme code
 *     (BrandingColorDeriver: packages/ui emailBrandColors) — platform packages never import the UI.
 */

const PERMISSION_READ = p['platform.tenant.read'];
const PERMISSION_MANAGE = p['platform.tenant.manage'];

/** The owner entity of every branding image: the organization's branding (the claims' organization). */
export function brandingOwner(tenantId: string): FileOwner {
  return { module: 'platform', entityType: 'tenant_branding', entityId: tenantId };
}

const Color = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/)
  .transform((v) => v.toUpperCase());

/** The website: https only, a host with a dot, no spaces, quotes, angle brackets or backslashes (≤ 300). */
export function isWebsiteUrl(value: string): boolean {
  if (value.length > 300) return false;
  if (!/^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[^\s\p{Cc}<>"'\\]*)?$/u.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && url.hostname.includes('.') && !url.username && !url.password
    );
  } catch {
    return false;
  }
}

const Website = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === '' || isWebsiteUrl(v), 'https website')
  .transform((v) => (v === '' ? null : v));

const FileId = z.uuid().nullable();

export const BrandingInput = z.strictObject({
  /** The branding's version as loaded (0: never saved). */
  version: z.int().min(0),
  nameEn: OrganizationNameInput,
  nameAr: OrganizationNameInput,
  primaryColor: Color.nullable(),
  secondaryColor: Color.nullable(),
  useGradient: z.boolean(),
  websiteUrl: Website,
  logoFileId: FileId,
  faviconFileId: FileId,
  signInImageFileId: FileId,
});

/** What the app's theme code makes of the chosen colours (stored colours; e-mail colours). */
export type BrandingColorDeriver = (settings: {
  readonly primary: string | null;
  readonly secondary: string | null;
  readonly gradient: boolean;
}) => {
  /** Null: the Jadarat look (nothing stored). */
  readonly stored: { readonly primary: string; readonly secondary: string } | null;
  readonly email: { readonly action: string; readonly link: string } | null;
};

export interface BrandingPageView {
  readonly branding: BrandingRecord;
  /** allowed (the Organization Admin) · denied (read only: e.g. an Auditor). */
  readonly editAccess: 'allowed' | 'denied';
}

export function brandingQueryDefinition(): QueryDefinition<
  z.ZodObject<Record<string, never>>,
  BrandingPageView,
  UserTx
> {
  return {
    permission: PERMISSION_READ,
    input: z.strictObject({}),
    handler: async ({ ctx }) => {
      const editAccess = ctx.can(PERMISSION_MANAGE, 'tenant') ? 'allowed' : 'denied';
      const branding = await getBranding(ctx.tx);
      if (!branding) return err(appError('NOT_CONFIGURED'));
      return ok({ branding, editAccess });
    },
  };
}

export interface BrandingSaved {
  readonly tenantId: string;
  readonly version: number;
  readonly changed: readonly BrandingField[];
  readonly before: Partial<BrandingSettings>;
  readonly after: Partial<BrandingSettings>;
}

function pick(
  settings: BrandingSettings,
  keys: readonly BrandingField[],
): Partial<BrandingSettings> {
  return Object.fromEntries(keys.map((key) => [key, settings[key]]));
}

const invalid = (path: string, code = 'INVALID'): AppError =>
  appError('VALIDATION_FAILED', { fieldErrors: [{ path, code }] });

export function saveBrandingActionDefinition(
  deriveColors: BrandingColorDeriver,
): ActionDefinition<typeof BrandingInput, BrandingSaved, UserTx> {
  return {
    permission: PERMISSION_MANAGE,
    input: BrandingInput,
    handler: async ({ ctx, input }) => {
      if ((input.primaryColor === null) !== (input.secondaryColor === null)) {
        return err(invalid(input.primaryColor === null ? 'primaryColor' : 'secondaryColor'));
      }
      const colors = deriveColors({
        primary: input.primaryColor,
        secondary: input.secondaryColor,
        gradient: input.useGradient,
      });
      const saved = await saveBranding(
        ctx.tx,
        {
          nameAr: input.nameAr,
          nameEn: input.nameEn,
          primaryColor: colors.stored?.primary ?? null,
          secondaryColor: colors.stored?.secondary ?? null,
          // The Jadarat look is always with its gradient.
          useGradient: colors.stored ? input.useGradient : true,
          websiteUrl: input.websiteUrl,
          logoFileId: input.logoFileId,
          faviconFileId: input.faviconFileId,
          signInImageFileId: input.signInImageFileId,
          emailActionColor: colors.stored ? (colors.email?.action ?? null) : null,
          emailLinkColor: colors.stored ? (colors.email?.link ?? null) : null,
        },
        input.version,
      );
      switch (saved.outcome) {
        case 'unchanged':
          return ok({
            tenantId: ctx.claims.tenant_id,
            version: saved.version,
            changed: [],
            before: {},
            after: {},
          });
        case 'invalid':
          return err(
            invalid(saved.field, saved.field.endsWith('FileId') ? 'IMAGE_NOT_USABLE' : 'INVALID'),
          );
        case 'conflict':
          return err(appError('CONFLICT_VERSION'));
        case 'unavailable':
          return err(appError('NOT_CONFIGURED'));
        case 'refused':
          return err(appError('FORBIDDEN'));
        case 'updated': {
          const changed = changedBrandingFields(saved.before, saved.after);
          return ok({
            tenantId: ctx.claims.tenant_id,
            version: saved.version,
            changed,
            before: pick(saved.before, changed),
            after: pick(saved.after, changed),
          });
        }
      }
    },
    // BR-BRD-a: who, when, before → after; images by file id (names and contents stay out).
    audit: (_input, output) =>
      output.changed.length === 0
        ? null
        : {
            action: 'platform.tenant.branding_changed',
            entityType: 'tenant',
            entityId: output.tenantId,
            data: { changed: output.changed, before: output.before, after: output.after },
          },
  };
}

// ---------------------------------------------------------------------------------------------------
// Images (platform-files, bound by the app)
// ---------------------------------------------------------------------------------------------------

/** The file service the app binds (platform-files: reserveUploadIntent, signUploadIntent, …). */
export interface BrandingFileService<Reservation, Intent> {
  /** Transaction step: validates name, size and type of the slot's purpose, reserves the upload. */
  reserve(
    tx: UserTx,
    request: {
      readonly slot: BrandImageKind;
      readonly owner: FileOwner;
      readonly declaredName: string;
      readonly size: number;
    },
  ): Promise<Result<Reservation, AppError>>;
  /** After the commit: the signed upload URL. */
  sign(reservation: Reservation): Promise<Result<Intent, AppError>>;
  confirm(tx: UserTx, fileId: string): Promise<Result<FileStatusView, AppError>>;
  status(tx: UserTx, fileId: string): Promise<FileStatusView | null>;
  /** The purpose of a slot (a file of another purpose is not this slot's image). */
  purposeOf(slot: BrandImageKind): string;
}

export const BrandImageUploadInput = z.strictObject({
  slot: z.enum(BRAND_IMAGE_KINDS),
  fileName: z.string().min(1).max(255),
  size: z
    .int()
    .min(1)
    .max(5 * 1024 * 1024),
});

export const BrandImageFileInput = z.strictObject({
  slot: z.enum(BRAND_IMAGE_KINDS),
  fileId: z.uuid(),
});

export function startBrandImageUploadActionDefinition<R, I>(
  files: BrandingFileService<R, I>,
): ActionDefinition<typeof BrandImageUploadInput, R, UserTx, I> {
  return {
    permission: PERMISSION_MANAGE,
    input: BrandImageUploadInput,
    handler: ({ ctx, input }) =>
      files.reserve(ctx.tx, {
        slot: input.slot,
        owner: brandingOwner(ctx.claims.tenant_id),
        declaredName: input.fileName,
        size: input.size,
      }),
    afterCommit: ({ result }) => files.sign(result),
  };
}

export interface BrandImageStatus {
  readonly fileId: string;
  readonly status: string;
  readonly reason: string | null;
}

/** The file must be this slot's branding image, uploaded by the caller (else NOT_FOUND). */
function ownSlotFile(
  view: FileStatusView | null,
  purpose: string,
): Result<BrandImageStatus, AppError> {
  if (view?.purpose !== purpose) return err(appError('NOT_FOUND'));
  return ok({ fileId: view.fileId, status: view.status, reason: view.reason });
}

/** After the browser's PUT: confirmed and queued for the malware scan. */
export function confirmBrandImageUploadActionDefinition<R, I>(
  files: BrandingFileService<R, I>,
): ActionDefinition<typeof BrandImageFileInput, BrandImageStatus, UserTx> {
  return {
    permission: PERMISSION_MANAGE,
    input: BrandImageFileInput,
    handler: async ({ ctx, input }) => {
      const before = ownSlotFile(
        await files.status(ctx.tx, input.fileId),
        files.purposeOf(input.slot),
      );
      if (!before.ok) return before;
      const confirmed = await files.confirm(ctx.tx, input.fileId);
      if (!confirmed.ok) return confirmed;
      return ownSlotFile(confirmed.value, files.purposeOf(input.slot));
    },
  };
}

/**
 * The scan's progress for the page, polled from the browser (the uploader only — files are visible to their
 * uploader). A read: nothing is written or audited.
 */
export function brandImageStatusActionDefinition<R, I>(
  files: BrandingFileService<R, I>,
): ActionDefinition<typeof BrandImageFileInput, BrandImageStatus, UserTx> {
  return {
    permission: PERMISSION_MANAGE,
    input: BrandImageFileInput,
    handler: async ({ ctx, input }) =>
      ownSlotFile(await files.status(ctx.tx, input.fileId), files.purposeOf(input.slot)),
  };
}
