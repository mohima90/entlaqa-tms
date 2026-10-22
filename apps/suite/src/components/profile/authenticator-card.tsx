'use client';
import { Alert, Badge, Button, Dialog, Icon, buttonClasses, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, createContext, useContext, useState, useTransition } from 'react';
import { removeMfaAppAction } from '../../auth/mfa';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';

/** The account's authenticator app as this window sees it (re-review N1). */
export type AuthenticatorCardApp =
  | { readonly state: 'off' }
  /** Confirmed: it counts. */
  | { readonly state: 'on'; readonly factorId: string }
  /** Set up in THIS window, waiting for the e-mailed code. */
  | { readonly state: 'pending'; readonly factorId: string }
  /** Added from ANOTHER sign-in, waiting for its code: `notice` says when and with which browser. */
  | { readonly state: 'elsewhere'; readonly factorId: string; readonly notice: string };

export interface AuthenticatorLabels {
  readonly title: string;
  readonly intro: string;
  readonly on: string;
  readonly off: string;
  readonly setUp: string;
  readonly remove: string;
  readonly removing: string;
  readonly removed: string;
  /** «Remove the authenticator app?» — the confirmation dialog's title (redesign package 6). */
  readonly removeConfirm: string;
  readonly removeNeedsCode: string;
  readonly verifyFirst: string;
  readonly removeWarning: string;
  readonly pending: string;
  readonly pendingText: string;
  readonly enterCode: string;
  readonly cancel: string;
  readonly cancelling: string;
  readonly cancelled: string;
  /** «Cancel» of the confirmation dialog. */
  readonly dismiss: string;
  readonly close: string;
  readonly elsewhere: string;
  readonly removeElsewhere: string;
  readonly removedElsewhere: string;
  readonly newPassword: string;
  readonly itWasMe: string;
  readonly itWasMeText: string;
}

interface Message {
  readonly tone: 'success' | 'danger' | 'warning';
  readonly text: string;
  readonly where: 'banner' | 'row';
  readonly stepUp?: boolean;
  readonly newPassword?: boolean;
}

interface Shared {
  readonly app: AuthenticatorCardApp;
  readonly setUpHref: string;
  readonly forgotPasswordHref: string;
  readonly labels: AuthenticatorLabels;
  readonly pending: boolean;
  readonly message: Message | null;
  readonly itWasMe: boolean;
  readonly confirming: boolean;
  readonly setItWasMe: (value: boolean) => void;
  readonly setConfirming: (value: boolean) => void;
  readonly remove: (
    factorId: string,
    done: string,
    options: { readonly where: 'banner' | 'row'; readonly newPassword?: boolean },
  ) => void;
}

const Context = createContext<Shared | null>(null);

function useShared(): Shared {
  const value = useContext(Context);
  if (!value)
    throw new Error('AuthenticatorBanner and AuthenticatorRow need AuthenticatorProvider');
  return value;
}

/**
 * My profile → the member's authenticator app (FR-IAM-12, T-M2-10), on the Sign-in and security tab
 * (redesign package 6, PO 21 Oct 2026). One provider holds the state for the two places it shows:
 * `AuthenticatorBanner` at the top of the tab (an app added from another sign-in matters most, and what
 * follows removing it) and `AuthenticatorRow` among the security rows. Set one up (the /mfa page), or
 * remove it — a confirmed app needs a recent code from it first, so a removal without one explains that
 * and links to the code; removing now asks for confirmation first (a destructive step: new in package 6).
 * A new app waits for the one-time code e-mailed to its owner, entered in the window that set it up
 * (re-review N1): this window links to the code page and can cancel the set-up. An app added from ANOTHER
 * sign-in is shown with when and which browser, with Remove (the account's other sessions end) and "it was
 * me".
 */
export function AuthenticatorProvider({
  app,
  setUpHref,
  forgotPasswordHref,
  labels,
  errors,
  children,
}: {
  readonly app: AuthenticatorCardApp;
  /** /mfa?next=… back to My profile's security tab. */
  readonly setUpHref: string;
  readonly forgotPasswordHref: string;
  readonly labels: AuthenticatorLabels;
  readonly errors: ErrorTexts;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [itWasMe, setItWasMe] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  function remove(
    factorId: string,
    done: string,
    options: { readonly where: 'banner' | 'row'; readonly newPassword?: boolean },
  ) {
    setMessage(null);
    startTransition(async () => {
      const result = await removeMfaAppAction({ factorId });
      setConfirming(false);
      if (result.ok) {
        if (options.newPassword) {
          setMessage({ tone: 'success', text: done, where: 'banner', newPassword: true });
        } else {
          toast.success(done);
        }
        router.refresh();
      } else if (result.error.code === 'STEP_UP_REQUIRED') {
        setMessage({ tone: 'warning', text: labels.removeNeedsCode, where: 'row', stepUp: true });
      } else if (!sessionRefused(result.error)) {
        setMessage({ tone: 'danger', text: errorText(result.error, errors), where: options.where });
      }
    });
  }

  return (
    <Context.Provider
      value={{
        app,
        setUpHref,
        forgotPasswordHref,
        labels,
        pending,
        message,
        itWasMe,
        confirming,
        setItWasMe,
        setConfirming,
        remove,
      }}
    >
      {children}
    </Context.Provider>
  );
}

function MessageAlert({ message }: { readonly message: Message }) {
  const { labels, setUpHref, forgotPasswordHref } = useShared();
  return (
    <Alert
      tone={message.tone}
      data-testid="profile-mfa-message"
      action={
        message.stepUp ? (
          <a href={setUpHref} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            {labels.verifyFirst}
          </a>
        ) : message.newPassword ? (
          <a
            href={forgotPasswordHref}
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          >
            {labels.newPassword}
          </a>
        ) : undefined
      }
    >
      {message.text}
    </Alert>
  );
}

/**
 * The top of the Sign-in and security tab: an authenticator app added from another sign-in (the
 * warning, with Remove this app / It was me) and, after removing it, the way to a new password.
 */
export function AuthenticatorBanner() {
  const { app, labels, pending, message, itWasMe, setItWasMe, remove } = useShared();
  const bannerMessage = message?.where === 'banner' ? message : null;
  if (app.state !== 'elsewhere' && !bannerMessage) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="profile-mfa-banner">
      {bannerMessage ? <MessageAlert message={bannerMessage} /> : null}
      {app.state === 'elsewhere' ? (
        <>
          <Alert tone="danger" title={labels.elsewhere} data-testid="profile-mfa-elsewhere">
            {app.notice}
          </Alert>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                remove(app.factorId, labels.removedElsewhere, {
                  where: 'banner',
                  newPassword: true,
                });
              }}
              busy={pending}
              disabled={pending}
              data-testid="profile-mfa-remove-elsewhere"
            >
              {pending ? labels.removing : labels.removeElsewhere}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setItWasMe(true);
              }}
              disabled={pending}
              aria-expanded={itWasMe}
              data-testid="profile-mfa-it-was-me"
            >
              {labels.itWasMe}
            </Button>
          </div>
          {itWasMe ? <p className="m-0 text-sm text-text-muted">{labels.itWasMeText}</p> : null}
        </>
      ) : null}
    </div>
  );
}

/** The multi-factor row of the security rows: its status as a pill and the action that fits it. */
export function AuthenticatorRow() {
  const { app, labels, setUpHref, pending, message, confirming, setConfirming, remove } =
    useShared();
  const badge =
    app.state === 'on'
      ? { tone: 'success' as const, text: labels.on }
      : app.state === 'pending'
        ? { tone: 'warning' as const, text: labels.pending }
        : app.state === 'elsewhere'
          ? { tone: 'danger' as const, text: labels.elsewhere }
          : { tone: 'neutral' as const, text: labels.off };
  const rowMessage = message?.where === 'row' ? message : null;

  return (
    <section aria-labelledby="mfa-title" data-testid="profile-mfa">
      <div className="grid grid-cols-1 items-start gap-2.5 md:grid-cols-[44px_minmax(0,1fr)_auto] md:gap-4">
        <span
          aria-hidden="true"
          className="hidden size-11 place-items-center rounded-[14px] bg-primary-subtle text-primary-text md:grid"
        >
          <Icon name="shield" className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="mfa-title" className="m-0 flex flex-wrap items-center gap-2.5 text-lg font-bold">
            {labels.title}
            <Badge tone={badge.tone} dot data-testid="profile-mfa-status">
              {badge.text}
            </Badge>
          </h2>
          <p className="m-0 mt-1 text-text-muted">{labels.intro}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 md:justify-end">
          {app.state === 'on' ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setConfirming(true);
              }}
              disabled={pending}
              data-testid="profile-mfa-remove"
            >
              <Icon name="trash" />
              {labels.remove}
            </Button>
          ) : app.state === 'off' ? (
            <a
              href={setUpHref}
              className={buttonClasses({ variant: 'secondary' })}
              data-testid="profile-mfa-set-up"
            >
              <Icon name="shield" />
              {labels.setUp}
            </a>
          ) : app.state === 'pending' ? (
            <>
              <a
                href={setUpHref}
                className={buttonClasses({ variant: 'secondary' })}
                data-testid="profile-mfa-enter-code"
              >
                {labels.enterCode}
              </a>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  remove(app.factorId, labels.cancelled, { where: 'row' });
                }}
                busy={pending}
                disabled={pending}
                data-testid="profile-mfa-cancel"
              >
                {pending ? labels.cancelling : labels.cancel}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {app.state === 'on' || app.state === 'pending' || rowMessage ? (
        <div className="mt-3 flex flex-col gap-3 md:ms-15">
          {app.state === 'on' ? (
            <p className="m-0 text-sm text-text-muted">{labels.removeWarning}</p>
          ) : null}
          {app.state === 'pending' ? (
            <p className="m-0 text-sm text-text-muted">{labels.pendingText}</p>
          ) : null}
          {rowMessage ? <MessageAlert message={rowMessage} /> : null}
        </div>
      ) : null}
      {app.state === 'on' ? (
        <Dialog
          open={confirming}
          onClose={() => {
            setConfirming(false);
          }}
          canClose={() => !pending}
          tone="danger"
          title={labels.removeConfirm}
          description={labels.removeWarning}
          closeLabel={labels.close}
          data-testid="profile-mfa-remove-dialog"
          footer={
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {labels.dismiss}
              </Button>
              <Button
                type="button"
                variant="danger"
                busy={pending}
                disabled={pending}
                onClick={() => {
                  remove(app.factorId, labels.removed, { where: 'row' });
                }}
                data-testid="profile-mfa-remove-confirm"
              >
                <Icon name="trash" />
                {pending ? labels.removing : labels.remove}
              </Button>
            </>
          }
        />
      ) : null}
    </section>
  );
}
