import { type AppError, type Result, appError, err, ok } from '@jadarat/platform-core';
import {
  type FileOwner,
  type FileStatusView,
  type ProfilePhotoPublication,
  type UserTx,
  getPersonPhotoContent,
  getPersonPhotoFacts,
  isDomainError,
  publishProfilePhoto,
  removeProfilePhoto,
} from '@jadarat/platform-db';
import { z } from 'zod';
import type { ActionDefinition } from '../define-action';
import type { QueryDefinition } from '../define-query';
import { memberPermissions } from '../member-permissions';

/**
 * My profile → Photo (WP-ADM-04, FR-IAM-16, FR-IAM-01; business flow EP-PEOPLE-photo-hr-fields BR-PPL-a..d,
 * PO answers 21 and 23 Oct 2026). Every member adds, replaces or removes THEIR OWN photo — nobody does it
 * for someone else (`platform.profile.manage_own` is held on one's own record only, and the database
 * function checks the upload belongs to the caller's own person). The photo is not virus-scanned (PO
 * answer 6): after the browser's PUT the upload is confirmed, then SAVED — read back with the member's own
 * Storage session BEFORE the transaction (type by content, 2 MB, pixels, metadata removed:
 * ProfilePhotoReader) and its copy published IN the transaction (private.publish_profile_photo), replacing
 * and deleting the previous photo. Audited with the file name only, never the picture.
 */
const manageOwn = memberPermissions['platform.profile.manage_own'];

/** The owner entity of a person's photo: the person themself. */
export function profilePhotoOwner(personId: string): FileOwner {
  return { module: 'platform', entityType: 'person', entityId: personId };
}

/** The file service the app binds (platform-files: reserveUploadIntent, signUploadIntent, …). */
export interface ProfilePhotoFileService<Reservation, Intent> {
  /** Transaction step: validates name, size and type, reserves the upload. */
  reserve(
    tx: UserTx,
    request: { readonly owner: FileOwner; readonly declaredName: string; readonly size: number },
  ): Promise<Result<Reservation, AppError>>;
  /** After the commit: the signed upload URL. */
  sign(reservation: Reservation): Promise<Result<Intent, AppError>>;
  confirm(tx: UserTx, fileId: string): Promise<Result<FileStatusView, AppError>>;
  status(tx: UserTx, fileId: string): Promise<FileStatusView | null>;
  /** The purpose of a profile photo (a file of another purpose is not one). */
  readonly purpose: string;
}

/** Why a photo cannot be used (platform-files ProfilePhotoRefusal), as the page shows it. */
export type ProfilePhotoReadRefusal =
  'TYPE_NOT_ALLOWED' | 'TOO_LARGE' | 'EMPTY' | 'DIMENSIONS_TOO_LARGE' | 'MALFORMED';

export type ProfilePhotoReading =
  | { readonly publication: ProfilePhotoPublication }
  | { readonly refused: ProfilePhotoReadRefusal }
  | { readonly missing: true };

/**
 * What the app binds (platform-files readProfilePhotoUpload with the request's own Storage session). Runs
 * BEFORE the save's transaction (never with a pooled connection held). Storage unavailable → an error result
 * (FILE_STORAGE_UNAVAILABLE): try again.
 */
export type ProfilePhotoReader = (request: {
  readonly tenantId: string;
  readonly personId: string;
  readonly fileId: string;
}) => Promise<Result<ProfilePhotoReading, AppError>>;

const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export const ProfilePhotoUploadInput = z.strictObject({
  fileName: z.string().min(1).max(255),
  size: z.int().min(1).max(PHOTO_MAX_BYTES),
});

export const ProfilePhotoFileInput = z.strictObject({ fileId: z.uuid() });

/** The upload reserved for the caller's OWN record, then the signed URL for the browser's PUT. */
export function startProfilePhotoUploadActionDefinition<R, I>(
  files: ProfilePhotoFileService<R, I>,
): ActionDefinition<typeof ProfilePhotoUploadInput, R, UserTx, I> {
  return {
    permission: manageOwn,
    input: ProfilePhotoUploadInput,
    scoped: true,
    handler: ({ ctx, input }) => {
      const personId = ctx.actor.personId;
      if (!personId) return Promise.resolve(err(appError('NOT_FOUND')));
      return files.reserve(ctx.tx, {
        owner: profilePhotoOwner(personId),
        declaredName: input.fileName,
        size: input.size,
      });
    },
    afterCommit: ({ result }) => files.sign(result),
  };
}

export interface ProfilePhotoStatus {
  readonly fileId: string;
  readonly status: string;
  readonly reason: string | null;
}

/** After the browser's PUT: confirmed (`uploaded`; empty, too large or stored with another type: `rejected`). */
export function confirmProfilePhotoUploadActionDefinition<R, I>(
  files: ProfilePhotoFileService<R, I>,
): ActionDefinition<typeof ProfilePhotoFileInput, ProfilePhotoStatus, UserTx> {
  return {
    permission: manageOwn,
    input: ProfilePhotoFileInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const own = (view: FileStatusView | null): Result<ProfilePhotoStatus, AppError> =>
        view?.purpose !== files.purpose
          ? err(appError('NOT_FOUND'))
          : ok({ fileId: view.fileId, status: view.status, reason: view.reason });
      const before = own(await files.status(ctx.tx, input.fileId));
      if (!before.ok) return before;
      const confirmed = await files.confirm(ctx.tx, input.fileId);
      if (!confirmed.ok) return confirmed;
      return own(confirmed.value);
    },
  };
}

export interface ProfilePhotoSaved {
  readonly personId: string;
  /** The sanitized upload name, for the audit event and the toast. */
  readonly fileName: string;
  readonly replaced: boolean;
}

const invalid = (code: string): AppError =>
  appError('VALIDATION_FAILED', { fieldErrors: [{ path: 'photo', code }] });

/**
 * Save the confirmed upload as the caller's photo. Refusals answer with the reason on the field `photo`:
 * `IMAGE_<reason>` (type, size, pixels, damaged) or `IMAGE_NOT_USABLE` (not the caller's usable upload).
 */
export function saveProfilePhotoActionDefinition(
  readPhoto: ProfilePhotoReader,
): ActionDefinition<
  typeof ProfilePhotoFileInput,
  ProfilePhotoSaved,
  UserTx,
  ProfilePhotoSaved,
  ProfilePhotoPublication
> {
  return {
    permission: manageOwn,
    input: ProfilePhotoFileInput,
    scoped: true,
    beforeTransaction: async ({ actor, input }) => {
      if (!actor.personId) return err(appError('NOT_FOUND'));
      const reading = await readPhoto({
        tenantId: actor.tenantId,
        personId: actor.personId,
        fileId: input.fileId,
      });
      if (!reading.ok) return reading;
      if ('refused' in reading.value) return err(invalid(`IMAGE_${reading.value.refused}`));
      if ('missing' in reading.value) return err(invalid('IMAGE_NOT_USABLE'));
      return ok(reading.value.publication);
    },
    handler: async ({ ctx, before: publication }) => {
      const personId = ctx.actor.personId;
      if (!personId || !publication) return err(appError('NOT_FOUND'));
      try {
        const saved = await publishProfilePhoto(ctx.tx, publication);
        return ok({ personId, fileName: saved.fileName, replaced: saved.replaced });
      } catch (error) {
        if (isDomainError(error, 'PHOTO_NOT_USABLE', 'PHOTO_MISMATCH')) {
          return err(invalid('IMAGE_NOT_USABLE'));
        }
        throw error;
      }
    },
    // File name only — never the picture (BR-PPL-i).
    audit: (_input, output) => ({
      action: output.replaced ? 'platform.profile.photo_replaced' : 'platform.profile.photo_added',
      entityType: 'person',
      entityId: output.personId,
      data: { fileName: output.fileName },
    }),
  };
}

export interface ProfilePhotoRemoved {
  readonly personId: string;
  /** Null: there was no photo (nothing changed). */
  readonly fileName: string | null;
}

/** Remove the caller's own photo: back to initials; the file is deleted. */
export function removeProfilePhotoActionDefinition(): ActionDefinition<
  z.ZodObject<Record<string, never>>,
  ProfilePhotoRemoved,
  UserTx
> {
  return {
    permission: manageOwn,
    input: z.strictObject({}),
    scoped: true,
    handler: async ({ ctx }) => {
      const personId = ctx.actor.personId;
      if (!personId) return err(appError('NOT_FOUND'));
      return ok({ personId, fileName: await removeProfilePhoto(ctx.tx) });
    },
    audit: (_input, output) =>
      output.fileName === null
        ? null
        : {
            action: 'platform.profile.photo_removed',
            entityType: 'person',
            entityId: output.personId,
            data: { fileName: output.fileName },
          },
  };
}

// ---------------------------------------------------------------------------------------------------
// Delivery: the /api/photo/<person> route
// ---------------------------------------------------------------------------------------------------

export const PersonPhotoInput = z.strictObject({
  personId: z.uuid(),
  /** The browser's If-None-Match, when it holds a copy. */
  ifNoneMatch: z.string().max(500).nullable(),
});

export type PersonPhotoAnswer =
  | { readonly notModified: true; readonly contentType: string; readonly sha256: string }
  | {
      readonly notModified: false;
      readonly contentType: string;
      readonly sha256: string;
      readonly content: Uint8Array;
    };

/** Does If-None-Match name this copy (a list, weak validators and `*` included)? */
export function matchesPhotoEtag(ifNoneMatch: string | null, sha256: string): boolean {
  if (ifNoneMatch === null) return false;
  return ifNoneMatch
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === '*' || tag === `"${sha256}"`);
}

/**
 * A person's photo for a signed-in member who may see that person (BR-PPL-d: the person, a reader of users
 * organization-wide, or a scoped reader whose team / department covers them). The DATABASE decides (row policy
 * of platform.person_photos): anything not visible is a plain NOT_FOUND, as is a person without a photo. A PASSIVE read (platform-db PASSIVE_READS): many small requests per page that must not keep an idle
 * session alive. A browser that holds the copy gets «not modified» without the bytes being read.
 */
export function personPhotoQueryDefinition(): QueryDefinition<
  typeof PersonPhotoInput,
  PersonPhotoAnswer,
  UserTx
> {
  return {
    permission: manageOwn,
    input: PersonPhotoInput,
    scoped: true,
    passiveRead: 'platform.person.photo',
    handler: async ({ ctx, input }) => {
      const facts = await getPersonPhotoFacts(ctx.tx, input.personId);
      if (!facts) return err(appError('NOT_FOUND'));
      if (matchesPhotoEtag(input.ifNoneMatch, facts.sha256)) {
        return ok({ notModified: true, contentType: facts.contentType, sha256: facts.sha256 });
      }
      const photo = await getPersonPhotoContent(ctx.tx, input.personId);
      if (!photo) return err(appError('NOT_FOUND'));
      return ok({
        notModified: false,
        contentType: photo.contentType,
        sha256: photo.sha256,
        content: photo.content,
      });
    },
  };
}
