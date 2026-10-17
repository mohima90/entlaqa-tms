'use server';
/**
 * Organization → Branches (FR-ADM-04 core fields; T-M3-02, EP-ORG): the HR Manager's branches. Definitions
 * and tests in @jadarat/platform-rbac (iam/branches.ts); the database repeats every rule (platform.branches).
 */
import {
  createBranchActionDefinition,
  defineAction,
  deleteBranchActionDefinition,
  setBranchStatusActionDefinition,
  updateBranchActionDefinition,
} from '@jadarat/platform-rbac';

export const createBranchAction = defineAction(createBranchActionDefinition());

export const updateBranchAction = defineAction(updateBranchActionDefinition());

/** Deactivate or activate a branch. */
export const setBranchStatusAction = defineAction(setBranchStatusActionDefinition());

/** Delete a branch nothing belongs to any more. */
export const deleteBranchAction = defineAction(deleteBranchActionDefinition());
