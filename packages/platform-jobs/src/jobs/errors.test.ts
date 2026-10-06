import { describe, expect, it } from 'vitest';
import { JobError, toJobError } from './errors';

describe('toJobError', () => {
  it('keeps the class name, a code from the error or its causes, and the stack locations', () => {
    const cause = Object.assign(new Error('duplicate key (email)=(sara@example.com)'), {
      code: '23505',
    });
    const wrapped = new Error('Failed query: insert … params: Sara', { cause });
    const safe = toJobError(wrapped, 'delivery');
    expect(safe).toBeInstanceOf(JobError);
    expect(safe.name).toBe('JobError');
    expect(safe.message).toBe('delivery failed: Error [23505]');
    expect(safe.stack).toMatch(/^JobError: delivery failed: Error \[23505\]\n\s+at /);
    expect(safe.stack).not.toMatch(/Sara|sara@/);
  });

  it('handles values that are not errors and codes that are not codes', () => {
    expect(toJobError('boom', 'dispatch').message).toBe('dispatch failed: string');
    expect(
      toJobError(Object.assign(new RangeError('x'), { code: 'not a code' }), 'x').message,
    ).toBe('x failed: RangeError');
  });
});
