'use server';
/**
 * Structure → Import units (WP-HR-01; FR-ADM-05): check a file (nothing written, nothing stored), then import its
 * good rows. Definitions and tests in @jadarat/platform-import (units/).
 */
import {
  applyUnitImportActionDefinition,
  checkUnitImportActionDefinition,
} from '@jadarat/platform-import';
import { defineAction } from '@jadarat/platform-rbac';

export const checkUnitImportAction = defineAction(checkUnitImportActionDefinition());

export const applyUnitImportAction = defineAction(applyUnitImportActionDefinition());
