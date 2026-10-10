'use server';
/**
 * Bulk user import (T-M2-12, FR-IAM-04; approved screens docs/design/screens/m2-user-import/): upload,
 * mapping, confirmation, stop, cancel, undo, the error report, and sending held invitations.
 * Definitions and tests in @jadarat/platform-import (actions.ts).
 */
import { requestFileStorage } from '@jadarat/platform-files/next';
import {
  cancelUserImportActionDefinition,
  chooseUserImportMappingActionDefinition,
  confirmUserImportActionDefinition,
  confirmUserImportUploadActionDefinition,
  downloadUserImportReportActionDefinition,
  sendHeldInvitationsActionDefinition,
  startUserImportActionDefinition,
  stopUserImportActionDefinition,
  undoUserImportActionDefinition,
} from '@jadarat/platform-import';
import { defineAction } from '@jadarat/platform-rbac';

/**
 * Step 1: reserve the upload and create the import (the action's transaction), then the signed URL for
 * the browser's PUT (afterCommit, with the user's own Storage session — T-M2-18 integration review M1).
 */
export const startUserImportAction = defineAction(
  startUserImportActionDefinition(requestFileStorage),
);

/** Step 1: after the PUT — the file is queued for the virus scan. */
export const confirmUserImportUploadAction = defineAction(
  confirmUserImportUploadActionDefinition(),
);

/** Step 2: the sheet and the column mapping; the dry run follows. */
export const chooseUserImportMappingAction = defineAction(
  chooseUserImportMappingActionDefinition(),
);

/** Step 5: start the run with the options of step 4. */
export const confirmUserImportAction = defineAction(confirmUserImportActionDefinition());

export const cancelUserImportAction = defineAction(cancelUserImportActionDefinition());

export const stopUserImportAction = defineAction(stopUserImportActionDefinition());

export const undoUserImportAction = defineAction(undoUserImportActionDefinition());

/**
 * The error report or the review's list of problems: the importer only; the download grant in the action's
 * transaction, then a 60-second link signed after the commit.
 */
export const downloadUserImportReportAction = defineAction(
  downloadUserImportReportActionDefinition(requestFileStorage),
);

/** «إرسال الدعوات» / «إرسال الدعوة»: held invitations scheduled for sending. */
export const sendHeldInvitationsAction = defineAction(sendHeldInvitationsActionDefinition());
