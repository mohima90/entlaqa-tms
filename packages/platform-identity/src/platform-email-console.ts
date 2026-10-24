import 'server-only';
import { type AppError, type Result, appError, err, ok } from '@jadarat/platform-core';
import {
  EmailSettingsError,
  type PlatformEmailView,
  type SaveSenderInput,
  type UserTx,
} from '@jadarat/platform-db';
import {
  type CredentialsPublicKey,
  type EmailProviderInput,
  sealProviderInput,
} from '@jadarat/platform-notifications';
import {
  type ConsoleInputParser,
  type PlatformConsoleDeps,
  platformConsoleAccess,
} from './platform-console';

/**
 * Platform settings → Email «البريد الإلكتروني» of the Super Admin console (WP-ADM-01; FR-ADM-17, FR-NTF-11;
 * Kawadir's (admin)/settings/email): the platform sender — provider, its secrets (write-only, sealed here on
 * the server for the worker, bound to the platform and the provider), sender name and address — and «حفظ
 * وإرسال رسالة تجريبية» / Save and send test: saving makes the sender unverified until the worker has sent
 * the test e-mail; e-mails wait meanwhile (nothing lost) and the page warns while any wait.
 *
 * Deny by default, as the rest of the console (platform-console.ts): a verified session of a user the
 * DATABASE says is a Super Admin — getUser before saving — else NOT_FOUND; the input is parsed only after the
 * access check (review L6). Audited by the database (private.platform_audit_events, never a secret or an
 * address).
 */
export interface PlatformEmailConsoleDeps extends Pick<
  PlatformConsoleDeps,
  'getClaims' | 'withUserTx' | 'isPlatformAdmin'
> {
  readonly getPlatformEmailSettings: (tx: UserTx) => Promise<PlatformEmailView>;
  readonly savePlatformEmailSettings: (
    tx: UserTx,
    input: SaveSenderInput & { readonly testTo: string },
  ) => Promise<number>;
  readonly getEmailCredentialsPublicKey: (tx: UserTx) => Promise<CredentialsPublicKey | null>;
  /**
   * Once the sender is saved and its test queued, in the same transaction: sends that test the moment the
   * action commits (WP-ADM-05 follow-up, "every e-mail arrives immediately"). Never throws.
   */
  readonly afterSave?: (tx: UserTx) => Promise<void>;
}

/** «حفظ وإرسال رسالة تجريبية»: what the Super Admin typed (validated by apps/suite lib). */
export interface PlatformEmailInput {
  /** The version the page showed; null when nothing was saved yet. */
  readonly version: number | null;
  readonly provider: EmailProviderInput;
  readonly fromName: string;
  readonly fromAddress: string;
  /** Where the test e-mail goes. */
  readonly testTo: string;
}

const notFound = (): Result<never, AppError> => err(appError('NOT_FOUND'));

const FIELD_PATHS: Readonly<Record<string, string>> = {
  provider: 'provider',
  options: 'options',
  credentials: 'secrets',
  from_name: 'fromName',
  from_address: 'fromAddress',
  test_to: 'testTo',
};

function refusal(error: unknown): Result<never, AppError> {
  if (!(error instanceof EmailSettingsError)) throw error;
  switch (error.code) {
    case 'EMAIL_SETTINGS_FORBIDDEN':
      return notFound();
    case 'EMAIL_SETTINGS_CONFLICT':
      return err(appError('CONFLICT_VERSION'));
    case 'EMAIL_SETTINGS_KEY_CHANGED':
      return err(
        appError('VALIDATION_FAILED', { fieldErrors: [{ path: 'form', code: 'KEY_CHANGED' }] }),
      );
    case 'EMAIL_SETTINGS_INVALID':
      return err(
        appError('VALIDATION_FAILED', {
          fieldErrors: [{ path: FIELD_PATHS[error.field ?? ''] ?? 'form', code: 'INVALID' }],
        }),
      );
    case 'EMAIL_SETTINGS_TOO_SOON':
      // One test e-mail a minute (every save sends one) — checked by the database.
      return err(appError('RATE_LIMITED', { fieldErrors: [{ path: 'form', code: 'TOO_SOON' }] }));
    default:
      return err(
        appError('VALIDATION_FAILED', { fieldErrors: [{ path: 'form', code: 'INVALID' }] }),
      );
  }
}

/** The page: the platform sender (never its secrets) and the messages waiting for a sender. */
export async function loadPlatformEmailSettings(
  deps: PlatformEmailConsoleDeps,
): Promise<Result<PlatformEmailView, AppError>> {
  const access = await platformConsoleAccess(deps);
  if (!access.ok) return access;
  try {
    return ok(await deps.withUserTx(access.value, (tx) => deps.getPlatformEmailSettings(tx)));
  } catch (error) {
    return refusal(error);
  }
}

/** «حفظ وإرسال رسالة تجريبية» / Save and send test. Untrusted input, parsed after the access check. */
export async function savePlatformEmailSettingsFromConsole(
  deps: PlatformEmailConsoleDeps,
  raw: unknown,
  parse: ConsoleInputParser<PlatformEmailInput>,
): Promise<Result<{ readonly version: number }, AppError>> {
  const access = await platformConsoleAccess(deps, { strict: true });
  if (!access.ok) return access;
  const parsed = parse(raw);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  try {
    return await deps.withUserTx(access.value, async (tx) => {
      let sealed: string | null = null;
      if (input.provider.secrets !== null) {
        const key = await deps.getEmailCredentialsPublicKey(tx);
        if (!key) {
          return err(
            appError('VALIDATION_FAILED', { fieldErrors: [{ path: 'form', code: 'NOT_SET_UP' }] }),
          );
        }
        sealed = sealProviderInput(key, { kind: 'platform' }, input.provider);
      }
      const version = await deps.savePlatformEmailSettings(tx, {
        provider: input.provider.provider,
        options: input.provider.options,
        credentialsSealed: sealed,
        fromName: input.fromName,
        fromAddress: input.fromAddress,
        testTo: input.testTo,
        version: input.version,
      });
      await deps.afterSave?.(tx);
      return ok({ version });
    });
  } catch (error) {
    return refusal(error);
  }
}
