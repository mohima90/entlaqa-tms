/** Security settings form helpers (screen 6; FR-IAM-12/13, T-M2-10; redesign package 2), client-safe. */
export type MfaMode = 'off' | 'optional' | 'required_all' | 'required_roles';

export interface SecurityFormValues {
  readonly mfaMode: MfaMode;
  readonly mfaRequiredRoles: readonly string[];
  readonly mfaGraceDays: number;
  readonly mfaPromptAdmins: boolean;
  readonly passwordMinLength: number;
  readonly lockoutThreshold: number;
  readonly lockoutMinutes: number;
  readonly sessionIdleMinutes: number;
  readonly sessionMaxHours: number;
  readonly sessionMaxDevices: number;
}

/** Whole numbers in any script (the inputs are numeric): «١٢» and "12" → 12; anything else → null. */
export function parseWhole(value: string): number | null {
  const western = value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).trim();
  return /^\d{1,4}$/.test(western) ? Number(western) : null;
}

/** Do two sets of settings say the same (the save bar's «unsaved changes»; roles in any order)? */
export function sameSecurity(a: SecurityFormValues, b: SecurityFormValues): boolean {
  const roles = (values: SecurityFormValues) => [...values.mfaRequiredRoles].sort().join('|');
  return (Object.keys(a) as (keyof SecurityFormValues)[]).every((field) =>
    field === 'mfaRequiredRoles' ? roles(a) === roles(b) : a[field] === b[field],
  );
}

/**
 * Does the change make MFA required where it was not (Off / Optional → Required for everyone or for
 * selected roles)? Then the page confirms first, saying who must set up an app and the grace days
 * (redesign package 2). Other changes save directly.
 */
export function mfaBecomesStricter(before: MfaMode, after: MfaMode): boolean {
  const required = (mode: MfaMode) => mode === 'required_all' || mode === 'required_roles';
  return !required(before) && required(after);
}
