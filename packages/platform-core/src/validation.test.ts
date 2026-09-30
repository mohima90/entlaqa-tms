import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { parseInput } from './validation';

describe('parseInput', () => {
  const Schema = z.object({ name: z.string().min(1), capacity: z.number().int().positive() });

  it('returns parsed data on success', () => {
    expect(parseInput(Schema, { name: 'x', capacity: 3 })).toEqual({
      ok: true,
      value: { name: 'x', capacity: 3 },
    });
  });

  it('returns VALIDATION_FAILED (422) with field paths, codes and bounds only (no input echo)', () => {
    const result = parseInput(Schema, { name: '', capacity: -1, secret: 'do-not-echo' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.status).toBe(422);
      expect(result.error.messageKey).toBe('errors.validationFailed');
      expect(result.error.expose).toBe(true);
      expect(JSON.stringify(result.error)).not.toContain('do-not-echo');
      expect(JSON.stringify(result.error)).not.toContain('-1');
      expect(result.error.fieldErrors).toEqual([
        { path: 'name', code: 'TOO_SMALL', params: { minimum: 1 } },
        { path: 'capacity', code: 'TOO_SMALL', params: { minimum: 0 } },
      ]);
    }
  });

  it('maps non-size issues without params', () => {
    const result = parseInput(z.object({ id: z.uuid() }), { id: 'nope' });
    expect(!result.ok && result.error.fieldErrors).toEqual([
      { path: 'id', code: 'INVALID_FORMAT' },
    ]);
  });

  it('reports upper bounds', () => {
    const result = parseInput(z.string().max(2), 'abc');
    expect(!result.ok && result.error.fieldErrors).toEqual([
      { path: '', code: 'TOO_BIG', params: { maximum: 2 } },
    ]);
  });
});
