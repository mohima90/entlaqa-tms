/** Discriminated-union result type: expected failures are values, not exceptions. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok;

export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

/** Returns the value or throws the error. Use only at boundaries where a failure is a bug. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error instanceof Error
    ? result.error
    : new Error('unwrap() called on an Err result');
}
