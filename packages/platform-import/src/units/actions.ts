import { type AppError, type Result, appError, err, ok } from '@jadarat/platform-core';
import {
  type UserTx,
  applyUnitImport,
  loadUnitImportContext,
  lockUnitImport,
} from '@jadarat/platform-db';
import {
  type ActionDefinition,
  type QueryDefinition,
  platformPermissions,
} from '@jadarat/platform-rbac';
import { z } from 'zod';
import {
  UNIT_IMPORT_MAX_BYTES,
  type UnitCheck,
  type UnitRowResult,
  checkUnitRows,
  headEmailsOf,
  readUnitFile,
} from './units';

/**
 * Structure → Import units (WP-HR-01; FR-ADM-05; EP-ORG-structure-completion.md §3 D): «Check» reads the file and
 * checks every row — nothing is written, no file is stored; «Import» checks the same file again and writes the good
 * rows in one transaction (problem rows are skipped). `platform.org.manage` (the HR Manager), as the rest of the
 * structure. Audited: platform.org.units_imported with the counts (no file content).
 */
const p = platformPermissions;

export const UnitImportFileInput = z.strictObject({
  /** The file's bytes, base64 (512 KB at most). */
  content: z
    .string()
    .max(Math.ceil((UNIT_IMPORT_MAX_BYTES * 4) / 3) + 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
});

export interface UnitImportCheckView {
  readonly rows: readonly UnitRowResult[];
  readonly counts: UnitCheck['counts'];
}

async function checkFile(tx: UserTx, content: string): Promise<Result<UnitCheck, AppError>> {
  const read = await readUnitFile(Uint8Array.from(Buffer.from(content, 'base64')));
  if (!read.ok) {
    return err(
      appError('VALIDATION_FAILED', { fieldErrors: [{ path: 'file', code: read.problem }] }),
    );
  }
  const context = await loadUnitImportContext(tx, headEmailsOf(read.rows));
  return ok(checkUnitRows(read.rows, context, read.columns));
}

/** «Check»: every row's result; nothing is written. */
export function checkUnitImportActionDefinition(): ActionDefinition<
  typeof UnitImportFileInput,
  UnitImportCheckView,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: UnitImportFileInput,
    handler: async ({ ctx, input }) => {
      const checked = await checkFile(ctx.tx, input.content);
      return checked.ok ? ok({ rows: checked.value.rows, counts: checked.value.counts }) : checked;
    },
  };
}

export interface UnitImportApplied {
  readonly created: number;
  readonly updated: number;
  readonly problems: number;
  /** For the audit: the codes created and the units updated (no names, no file content). */
  readonly createdCodes: readonly string[];
  readonly updatedIds: readonly string[];
}

/** «Import»: the good rows, in one go; the structure changed since the check → nothing is written. */
export function applyUnitImportActionDefinition(): ActionDefinition<
  typeof UnitImportFileInput,
  UnitImportApplied,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: UnitImportFileInput,
    handler: async ({ ctx, input }) => {
      // The lock first: the check below and the writes see the same structure.
      await lockUnitImport(ctx.tx);
      const checked = await checkFile(ctx.tx, input.content);
      if (!checked.ok) return checked;
      if (checked.value.operations.length === 0) {
        return err(
          appError('VALIDATION_FAILED', {
            fieldErrors: [{ path: 'file', code: 'NOTHING_TO_IMPORT' }],
          }),
        );
      }
      const outcome = await applyUnitImport(ctx.tx, checked.value.operations);
      if (!outcome.ok) {
        return err(
          appError('VALIDATION_FAILED', {
            fieldErrors: [{ path: 'file', code: 'STRUCTURE_CHANGED' }],
            params: { row: outcome.row },
          }),
        );
      }
      return ok({
        created: outcome.created,
        updated: outcome.updated,
        problems: checked.value.counts.problems,
        createdCodes: outcome.createdCodes,
        updatedIds: outcome.updatedIds,
      });
    },
    audit: (_input, output) => ({
      action: 'platform.org.units_imported',
      entityType: 'structure',
      data: {
        created: output.created,
        updated: output.updated,
        skipped: output.problems,
        createdCodes: output.createdCodes,
        updatedIds: output.updatedIds,
      },
    }),
  };
}

export const UnitImportTemplateInput = z.strictObject({});

/** The template's download is a read for the HR Manager (`platform.org.manage`). */
export function unitImportTemplateQueryDefinition(): QueryDefinition<
  typeof UnitImportTemplateInput,
  null,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: UnitImportTemplateInput,
    handler: () => Promise.resolve(ok(null)),
  };
}
