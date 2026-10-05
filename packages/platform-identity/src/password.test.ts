import { describe, expect, it, vi } from 'vitest';
import { AuthServiceError } from './auth-flow';
import { type PasswordChangeDeps, type PasswordClientLike, changePassword } from './password';

const input = { currentPassword: 'Old-password-123', newPassword: 'New-password-456' };

function setup(
  over: {
    user?: { id: string; email?: string } | null;
    verdict?: 'valid' | 'invalid' | 'rate_limited';
    updateError?: { status?: number; code?: string } | null;
    signOutError?: unknown;
  } = {},
) {
  const updateUser = vi.fn(() => Promise.resolve({ error: over.updateError ?? null }));
  const signOut = vi.fn(() => Promise.resolve({ error: over.signOutError ?? null }));
  const supabase: PasswordClientLike = {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: {
            user: over.user === undefined ? { id: 'u1', email: 'u1@example.test' } : over.user,
          },
          error: null,
        }),
      updateUser,
      signOut,
    },
  };
  const verifyPassword = vi.fn(() => Promise.resolve(over.verdict ?? 'valid'));
  const logWarning = vi.fn();
  const deps: PasswordChangeDeps = { supabase, verifyPassword, logWarning };
  return { deps, updateUser, signOut, verifyPassword, logWarning };
}

describe('changePassword (FR-IAM-16)', () => {
  it('checks the current password, sets the new one and ends the other sessions', async () => {
    const { deps, updateUser, signOut, verifyPassword } = setup();
    expect(await changePassword(deps, input)).toEqual({ ok: true, value: { userId: 'u1' } });
    expect(verifyPassword).toHaveBeenCalledWith('u1@example.test', 'Old-password-123');
    expect(updateUser).toHaveBeenCalledWith({
      password: 'New-password-456',
      current_password: 'Old-password-123',
    });
    expect(signOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('refuses a wrong current password without touching the password', async () => {
    const { deps, updateUser, logWarning } = setup({ verdict: 'invalid' });
    const result = await changePassword(deps, input);
    expect(!result.ok && result.error.code).toBe('AUTH_CURRENT_PASSWORD_INVALID');
    expect(updateUser).not.toHaveBeenCalled();
    // Logged without the password or e-mail.
    expect(JSON.stringify(logWarning.mock.calls)).not.toContain('Old-password');
    expect(JSON.stringify(logWarning.mock.calls)).not.toContain('example.test');
  });

  it('maps Auth answers to clear errors', async () => {
    const cases: [Parameters<typeof setup>[0], string][] = [
      [{ verdict: 'rate_limited' }, 'RATE_LIMITED'],
      [{ updateError: { status: 429 } }, 'RATE_LIMITED'],
      [{ updateError: { status: 422, code: 'weak_password' } }, 'AUTH_PASSWORD_TOO_WEAK'],
      [{ updateError: { status: 422, code: 'same_password' } }, 'AUTH_PASSWORD_SAME'],
      [
        { updateError: { status: 400, code: 'current_password_mismatch' } },
        'AUTH_CURRENT_PASSWORD_INVALID',
      ],
      [
        { updateError: { status: 401, code: 'reauthentication_needed' } },
        'AUTH_REAUTHENTICATION_NEEDED',
      ],
      [{ user: null }, 'UNAUTHENTICATED'],
      [{ user: { id: 'u1' } }, 'UNAUTHENTICATED'],
    ];
    for (const [over, code] of cases) {
      const result = await changePassword(setup(over).deps, input);
      expect(!result.ok && result.error.code, code).toBe(code);
    }
  });

  it('throws when Auth cannot answer (logged as INTERNAL_ERROR by defineAction)', async () => {
    await expect(
      changePassword(setup({ updateError: { status: 500 } }).deps, input),
    ).rejects.toBeInstanceOf(AuthServiceError);
  });

  it('keeps the new password but logs when the other sessions cannot be ended', async () => {
    const { deps, logWarning } = setup({ signOutError: new Error('x') });
    const result = await changePassword(deps, input);
    expect(result.ok).toBe(true);
    expect(logWarning).toHaveBeenCalled();
  });

  it('is not configured without Supabase', async () => {
    const result = await changePassword({ ...setup().deps, supabase: null }, input);
    expect(!result.ok && result.error.code).toBe('NOT_CONFIGURED');
  });
});
