import type { AppError } from '@jadarat/platform-core';

/**
 * Deactivation screen helpers (T-M2-09, FR-IAM-05; screen 4) — shared by the page (server) and the form
 * (client). The server repeats every rule; these only shape the input and the messages.
 */

/** Users-list flash after a deactivation (`?tab=deactivated&deactivated=1`). */
export const DEACTIVATED_FLASH_PARAM = 'deactivated';
/** Flash after a reactivation, on the profile or the users list (`?reactivated=1`). */
export const REACTIVATED_FLASH_PARAM = 'reactivated';

/** One kind of item the person is responsible for, as the form shows it. */
export interface DeactivationKindView {
  readonly code: string;
  /** Moving it is refused for the signed-in member (permission or an item outside their scope). */
  readonly blocked: boolean;
}

export interface DeactivateFormState {
  /** «نقل الكل إلى»: fills every kind's owner when chosen. */
  readonly allTo: string;
  /** The new owner per kind code ('' = none chosen). */
  readonly owners: Readonly<Record<string, string>>;
  /** Reason code, '' = not stated. */
  readonly reason: string;
}

export function initialDeactivateState(
  kinds: readonly DeactivationKindView[],
): DeactivateFormState {
  return { allTo: '', owners: Object.fromEntries(kinds.map((k) => [k.code, ''])), reason: '' };
}

/** «نقل الكل إلى»: one person for every kind (each can still be changed afterwards). */
export function chooseForAll(
  state: DeactivateFormState,
  kinds: readonly DeactivationKindView[],
  personId: string,
): DeactivateFormState {
  return {
    ...state,
    allTo: personId,
    owners: Object.fromEntries(kinds.map((k) => [k.code, personId])),
  };
}

/** The kinds that still need an owner before the form can be sent. */
export function missingOwners(
  state: DeactivateFormState,
  kinds: readonly DeactivationKindView[],
): string[] {
  return kinds.filter((k) => !k.blocked && (state.owners[k.code] ?? '') === '').map((k) => k.code);
}

/** The action's input. */
export function deactivateInput(
  personId: string,
  state: DeactivateFormState,
  kinds: readonly DeactivationKindView[],
): {
  personId: string;
  reason: string;
  reassign: { kind: string; toPersonId: string }[];
} {
  return {
    personId,
    reason: state.reason,
    reassign: kinds
      .filter((k) => !k.blocked && (state.owners[k.code] ?? '') !== '')
      .map((k) => ({ kind: k.code, toPersonId: state.owners[k.code] ?? '' })),
  };
}

/** Message keys (namespace `deactivation`) for a refused deactivation: per kind and for the form. */
export interface DeactivationErrorKeys {
  readonly form: string | null;
  readonly kinds: Readonly<Record<string, string>>;
}

const KIND_CODES: Readonly<Record<string, string>> = {
  NOT_ALLOWED: 'itemsBlocked.item_not_allowed',
  OWNER_INVALID: 'fieldErrors.ownerInvalid',
  OWNER_REPORTS_TO_PERSON: 'fieldErrors.ownerReportsToPerson',
};

/**
 * Field errors of the action (`personId`, `reassign.<kind code>`, `reassign.<index>.kind`) as message keys;
 * null form key and no kind keys: show the general error text instead.
 */
export function deactivationErrorKeys(
  error: AppError,
  kinds: readonly DeactivationKindView[],
): DeactivationErrorKeys {
  const shown = new Set(kinds.map((k) => k.code));
  const keys: Record<string, string> = {};
  let form: string | null = null;
  for (const fieldError of error.fieldErrors ?? []) {
    const { path, code } = fieldError;
    if (path === 'personId') {
      form ??= code === 'LAST_ADMIN' ? 'blocked.last_admin' : 'fieldErrors.notActive';
      continue;
    }
    const kind = /^reassign\.([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)$/.exec(path)?.[1];
    if (kind && shown.has(kind)) {
      keys[kind] ??=
        code === 'OWNER_REQUIRED'
          ? 'fieldErrors.ownerRequired'
          : (KIND_CODES[code] ?? 'fieldErrors.changed');
      continue;
    }
    // A kind the page did not show (taken on after it loaded), or one it does not know any more.
    if (path.startsWith('reassign')) form ??= 'fieldErrors.changed';
  }
  return { form, kinds: keys };
}

/** Message key (namespace `deactivation`) for a refused reactivation, or null for the general text. */
export function reactivationErrorKey(error: AppError): string | null {
  if (error.code === 'STEP_UP_REQUIRED') return 'reactivate.stepUp';
  const code = error.fieldErrors?.find((f) => f.path === 'personId')?.code;
  if (code === 'NOT_DEACTIVATED') return 'reactivate.notDeactivated';
  if (code === 'PLACEMENT_DELETED') return 'reactivate.placementDeleted';
  return null;
}

/** «أحمد، سارة، خالد (+2)»: the first names and how many more. */
export function itemNames(
  names: readonly string[],
  more: (count: number) => string,
  separator: string,
  shown = 3,
): string {
  const head = names.slice(0, shown).join(separator);
  return names.length > shown ? `${head} ${more(names.length - shown)}` : head;
}
