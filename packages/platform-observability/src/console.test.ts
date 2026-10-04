import { describe, expect, it, vi } from 'vitest';
import { formatErrorForLog, installConsoleScrubbing } from './console';

function fakeConsole() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn(), debug: vi.fn() };
}

describe('formatErrorForLog', () => {
  it('keeps class, code and stack locations but not the message', () => {
    const error = Object.assign(new Error('Failed query: insert … params: Sara,0501234567'), {
      code: '23505',
    });
    const text = formatErrorForLog(error);
    expect(text.split('\n')[0]).toBe('Error [23505]: [redacted]');
    expect(text).toMatch(/\n\s+at /);
    expect(text).not.toMatch(/Sara|0501234567|Failed query/);
  });

  it('keeps allow-listed messages (scrubbed) and ignores odd codes', () => {
    class AuthServiceError extends Error {
      override name = 'AuthServiceError';
      code = 'not a code!';
    }
    const text = formatErrorForLog(
      new AuthServiceError('Supabase Auth request failed (status 503)'),
    );
    expect(text.split('\n')[0]).toBe('AuthServiceError: Supabase Auth request failed (status 503)');
  });

  it('copes with an error without a stack', () => {
    const error = new TypeError('x');
    delete error.stack;
    expect(formatErrorForLog(error)).toBe('TypeError: [redacted]');
  });
});

describe('installConsoleScrubbing', () => {
  it('scrubs strings, errors and objects passed to every console method, once', () => {
    const target = fakeConsole();
    const original = target.error;
    installConsoleScrubbing(target);
    installConsoleScrubbing(target);
    target.error('⨯ failed for a@b.co', new Error('secret input'), { email: 'c@d.co', n: 1 }, 7);
    expect(original).toHaveBeenCalledTimes(1);
    const [text, error, object, number] = original.mock.calls[0] ?? [];
    expect(text).toBe('⨯ failed for [email]');
    expect(String(error)).toMatch(/^Error: \[redacted\]/);
    expect(object).toBe("{ email: '[email]', n: 1 }");
    expect(number).toBe(7);
    target.warn('x 0501234567');
    expect(target.warn).not.toBe(original);
  });

  it('defaults to the global console', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installConsoleScrubbing();
    console.warn('to a@b.co');
    expect(spy).toHaveBeenCalledWith('to [email]');
    spy.mockRestore();
  });
});
