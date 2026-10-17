'use server';
/**
 * Needs forms library and builder (T-M3-10; FR-PLN-02/03): the L&D Manager's changes. Definitions, rules
 * and tests in @jadarat/tms (needs-forms); the database guards enforce the same rules (tms.needs_forms).
 */
import { defineAction } from '@jadarat/platform-rbac';
import {
  createNeedsFormActionDefinition,
  deleteFieldActionDefinition,
  deleteNeedsFormActionDefinition,
  deleteSectionActionDefinition,
  duplicateNeedsFormActionDefinition,
  moveFieldActionDefinition,
  moveSectionActionDefinition,
  renameNeedsFormActionDefinition,
  saveFieldActionDefinition,
  saveSectionActionDefinition,
  setDefaultNeedsFormActionDefinition,
  setFieldRequiredActionDefinition,
  setFieldVisibleActionDefinition,
  setNeedsFormActiveActionDefinition,
  setSectionVisibleActionDefinition,
} from '@jadarat/tms/needs-forms/server';

export const createNeedsFormAction = defineAction(createNeedsFormActionDefinition());
export const duplicateNeedsFormAction = defineAction(duplicateNeedsFormActionDefinition());
export const renameNeedsFormAction = defineAction(renameNeedsFormActionDefinition());
export const setDefaultNeedsFormAction = defineAction(setDefaultNeedsFormActionDefinition());
export const setNeedsFormActiveAction = defineAction(setNeedsFormActiveActionDefinition());
/** Not the default form, not a locked one. */
export const deleteNeedsFormAction = defineAction(deleteNeedsFormActionDefinition());

export const saveSectionAction = defineAction(saveSectionActionDefinition());
export const setSectionVisibleAction = defineAction(setSectionVisibleActionDefinition());
export const moveSectionAction = defineAction(moveSectionActionDefinition());
export const deleteSectionAction = defineAction(deleteSectionActionDefinition());
export const saveFieldAction = defineAction(saveFieldActionDefinition());
export const setFieldVisibleAction = defineAction(setFieldVisibleActionDefinition());
export const setFieldRequiredAction = defineAction(setFieldRequiredActionDefinition());
export const moveFieldAction = defineAction(moveFieldActionDefinition());
export const deleteFieldAction = defineAction(deleteFieldActionDefinition());
