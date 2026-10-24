'use server';
/**
 * Plans and an organization's plan and status in the Super Admin console (WP-ADM-06; FR-ADM-13, FR-SUB-01,
 * FR-ADM-17). Public actions because a Super Admin's session has NO organization: every check is in
 * @jadarat/platform-identity (platform-plans-console.ts) — the session confirmed with Auth (getUser) and the
 * database's decision that the user is a Super Admin (and again inside every database function). Anyone else
 * gets NOT_FOUND, whatever they send: the input is parsed only AFTER that check (security review L6).
 */
import { parseInput } from '@jadarat/platform-core';
import {
  savePlanFromConsoleForRequest,
  setOrganizationPlanFromConsoleForRequest,
} from '@jadarat/platform-identity/auth';
import { definePublicAction } from '@jadarat/platform-rbac';
import { z } from 'zod';
import { PlanFormInput, TenantPlanFormInput } from '../lib/platform-plans-input';

/** Untrusted: validated by the handler after the access check (review L6). */
const Unvalidated = z.unknown();

/** «حفظ الخطة» / Save plan: a new plan, or changes to one (they apply to every organization on it). */
export const savePlanAction = definePublicAction({
  name: 'platform.console.save_plan',
  input: Unvalidated,
  handler: async ({ input }) =>
    savePlanFromConsoleForRequest(input, (raw) => parseInput(PlanFormInput, raw)),
});

/** «حفظ التغييرات» / Save changes: an organization's plan, status, trial end date and special limits. */
export const setOrganizationPlanAction = definePublicAction({
  name: 'platform.console.set_organization_plan',
  input: Unvalidated,
  handler: async ({ input }) =>
    setOrganizationPlanFromConsoleForRequest(input, (raw) => parseInput(TenantPlanFormInput, raw)),
});
