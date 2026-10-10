/**
 * The limits of the security settings form (screen 6; FR-IAM-12/13, T-M2-10), client-safe: the same values
 * as the database's CHECK constraints (migration 20261012090000) and the server's validation
 * (platform-db SECURITY_LIMITS — the unit test keeps them equal). Lockout: the platform default (5 attempts,
 * 15 minutes) or stricter (TM-0003 T-IAM-24, review L5).
 */
export const SECURITY_FORM_LIMITS = {
  mfaGraceDays: { min: 0, max: 30 },
  passwordMinLength: { min: 12, max: 36 },
  lockoutThreshold: { min: 3, max: 5 },
  lockoutMinutes: { min: 15, max: 60 },
  sessionIdleMinutes: { min: 5, max: 480 },
  sessionMaxHours: { min: 1, max: 24 },
  sessionMaxDevices: { min: 1, max: 10 },
} as const;

export type SecurityNumberField = keyof typeof SECURITY_FORM_LIMITS;
