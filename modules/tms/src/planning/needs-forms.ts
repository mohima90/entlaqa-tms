import type { UserTx } from '@jadarat/platform-db';

/**
 * The needs forms a planning cycle can use (PO, 17 Oct 2026: the needs form is customizable per
 * organization — a form builder, built in parallel in its own branch: forms library tables in the `tms`
 * schema, migrations 2026102018xxxx, and `lock_needs_form(form_id)` to lock a form once a cycle uses it).
 *
 * STUB until that branch merges: no forms exist yet, so the cycle's «Needs form» choice offers none and
 * `tms.plan_cycles.needs_form_id` stays empty. When merging, the tech lead replaces this adapter with the
 * forms library's query (published forms of the organization), adds the foreign key on needs_form_id and
 * calls lock_needs_form at launch (launchPlanCycleActionDefinition).
 */
export interface NeedsFormOption {
  readonly id: string;
  readonly name: { readonly ar: string; readonly en: string | null };
}

export function listNeedsFormOptions(_tx: UserTx): Promise<readonly NeedsFormOption[]> {
  // TODO(forms library merge): read the organization's published needs forms with the transaction.
  return Promise.resolve([]);
}
