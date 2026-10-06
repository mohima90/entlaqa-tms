'use server';
/**
 * Users administration (T-M2-13): HR / Organization Admin edits a person's details and placement.
 * Definitions and tests in @jadarat/platform-rbac (iam/edit-user.ts).
 */
import { defineAction, updateUserDetailsActionDefinition } from '@jadarat/platform-rbac';

export const updateUserDetailsAction = defineAction(updateUserDetailsActionDefinition());
