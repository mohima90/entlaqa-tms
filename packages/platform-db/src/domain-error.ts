/**
 * A business refusal the caller is expected to handle (show a message, pick another path), identified by
 * a stable SCREAMING_SNAKE code. Thrown by request-path helpers whose contract names the codes (e.g.
 * invitations: EMAIL_TAKEN, ROLE_NOT_ALLOWED, INVITATION_NOT_VALID). The message is the code itself:
 * never personal data or SQL. The database error, when there is one, is kept as `cause` for logs.
 */
export class DomainError<C extends string = string> extends Error {
  override readonly name = 'DomainError';
  readonly code: C;

  constructor(code: C, options?: { readonly cause?: unknown }) {
    super(code, options);
    this.code = code;
  }
}

/** True when `error` is a DomainError (optionally with one of `codes`). */
export function isDomainError<C extends string>(
  error: unknown,
  ...codes: readonly C[]
): error is DomainError<C> {
  return error instanceof DomainError && (codes.length === 0 || codes.includes(error.code as C));
}
