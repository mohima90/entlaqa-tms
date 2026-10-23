'use server';
/**
 * Organization → Grades (WP-ADM-04): the organization's list of grade codes, kept by the HR Manager and the
 * Organization Admin. Definitions and tests in @jadarat/platform-rbac (iam/grades.ts).
 */
import {
  addGradeActionDefinition,
  defineAction,
  deleteGradeActionDefinition,
  renameGradeActionDefinition,
} from '@jadarat/platform-rbac';

export const addGradeAction = defineAction(addGradeActionDefinition());
export const renameGradeAction = defineAction(renameGradeActionDefinition());
export const deleteGradeAction = defineAction(deleteGradeActionDefinition());
