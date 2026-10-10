'use server';
/**
 * Bulk user import (T-M2-12, FR-IAM-04; approved screens docs/design/screens/m2-user-import/): upload,
 * mapping, confirmation, stop, cancel, undo, the error report, and sending held invitations.
 * Definitions and tests in @jadarat/platform-import (actions.ts).
 */
import { fileRequestContext } from '@jadarat/platform-files/next';
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

/** Step 1: reserve the upload (signed URL for the browser's PUT) and create the import. */
export const startUserImportAction = defineAction(
  startUserImportActionDefinition(fileRequestContext),
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

/** The error report or the review's list of problems: a 60-second link, the importer only. */
export const downloadUserImportReportAction = defineAction(
  downloadUserImportReportActionDefinition(fileRequestContext),
);

/** «إرسال الدعوات» / «إرسال الدعوة»: held invitations scheduled for sending. */
export const sendHeldInvitationsAction = defineAction(sendHeldInvitationsActionDefinition());
