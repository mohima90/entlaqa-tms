import { describe, expect, it } from 'vitest';
import { andThen, err, isErr, isOk, mapResult, ok, unwrap } from './result';

describe('Result', () => {
  it('creates ok and err values', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('x')).toEqual({ ok: false, error: 'x' });
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(err('x'))).toBe(true);
  });

  it('maps and chains only on success', () => {
    expect(mapResult(ok(2), (n) => n * 2)).toEqual(ok(4));
    expect(mapResult(err('e'), (n: number) => n * 2)).toEqual(err('e'));
    expect(andThen(ok(2), (n) => (n > 1 ? ok(n) : err('small')))).toEqual(ok(2));
    expect(andThen(ok(0), (n) => (n > 1 ? ok(n) : err('small')))).toEqual(err('small'));
    expect(andThen(err('e'), () => ok(1))).toEqual(err('e'));
  });

  it('unwrap returns the value or throws', () => {
    expect(unwrap(ok('v'))).toBe('v');
    expect(() => unwrap(err(new Error('boom')))).toThrow('boom');
    expect(() => unwrap(err('plain'))).toThrow('unwrap() called on an Err result');
  });
});
