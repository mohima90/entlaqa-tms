'use server';
/**
 * My profile (FR-IAM-16): the member's own personal details and password. Definitions and tests in
 * @jadarat/platform-rbac (iam/my-profile.ts); the password flow in @jadarat/platform-identity.
 */
import {
  allowPasswordCheckForRequest,
  changePasswordForRequest,
  queueOwnPasswordChangedNoticeForRequest,
} from '@jadarat/platform-identity/auth';
import {
  changeMyPasswordActionDefinition,
  confirmProfilePhotoUploadActionDefinition,
  defineAction,
  removeProfilePhotoActionDefinition,
  saveProfilePhotoActionDefinition,
  startProfilePhotoUploadActionDefinition,
  updateMyProfileActionDefinition,
} from '@jadarat/platform-rbac';
import { profilePhotoFiles, readProfilePhoto } from '../lib/profile-photo-files';

export const updateMyProfileAction = defineAction(updateMyProfileActionDefinition());

// Current-password checks are limited per user before the action's transaction (T-M2-11). After a
// successful change: the "password changed" notice through our notification service when
// PASSWORD_RESET_DELIVERY=worker (T-M2-17); never fails the change.
export const changeMyPasswordAction = defineAction(
  changeMyPasswordActionDefinition(changePasswordForRequest, {
    allowPasswordCheck: allowPasswordCheckForRequest,
    afterChange: queueOwnPasswordChangedNoticeForRequest,
  }),
);

// My profile → Photo (WP-ADM-04): the member's OWN photo only. Reserve + signed URL → the browser's PUT →
// confirm → save (read back, checked, stripped of hidden details and published at once: no virus scan) or
// remove. Audited with the file name only.
export const startProfilePhotoUploadAction = defineAction(
  startProfilePhotoUploadActionDefinition(profilePhotoFiles),
);
export const confirmProfilePhotoUploadAction = defineAction(
  confirmProfilePhotoUploadActionDefinition(profilePhotoFiles),
);
export const saveProfilePhotoAction = defineAction(
  saveProfilePhotoActionDefinition(readProfilePhoto),
);
export const removeProfilePhotoAction = defineAction(removeProfilePhotoActionDefinition());
