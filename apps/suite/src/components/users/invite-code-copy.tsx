'use client';
import type { AppError, Result } from '@jadarat/platform-core';
import { Button } from '@jadarat/ui';
import { useEffect, useRef, useState } from 'react';
import { displayInviteCode } from '../../lib/invite-code';
import { inviteLink } from '../../lib/invite-link';
import { AuthIcon } from '../auth/auth-icons';

/** Texts of the copy controls (namespace `invitations.copy`). */
export interface InviteCopyTexts {
  readonly codeLabel: string;
  readonly copyCode: string;
  readonly copyLink: string;
  readonly codeCopied: string;
  readonly linkCopied: string;
  readonly copyFailed: string;
  readonly loading: string;
}

/** An invitation's code as the server answered it: the language its link opens in, the canonical link. */
export interface InviteCodeValue {
  readonly inviteCode: string;
  readonly locale: 'ar' | 'en';
  /** On the app's canonical origin (APP_BASE_URL); null → this page's origin. */
  readonly inviteLink: string | null;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The link to copy: the server's canonical one, else built on this page's own origin. */
function linkOf(value: InviteCodeValue): string {
  return value.inviteLink ?? inviteLink(window.location.origin, value.locale, value.inviteCode);
}

/**
 * Kawadir's invite code chip (PO, 16 Oct 2026): the code in a monospace chip, shown grouped
 * `XXXX-XXXX-XXXX`, with «نسخ الرمز» / "Copy code", and «نسخ الرابط» / "Copy invite link" — the app's
 * canonical origin (APP_BASE_URL, from the server; else this page's own), the invitation's language and
 * the code in the URL fragment (`/{locale}/sign-up#code=…`). Copying changes nothing on the server (not a
 * resend).
 *
 * Two modes: `value` — the code is known (right after inviting, the console's dialogs); `load` — it is read
 * from the server when first copied (the invitations list never carries codes: an authorized, audited
 * action, security review M2), then shown. Every outcome is announced in a live region that is cleared and
 * set again, so copying twice is announced twice; when the browser refuses the clipboard, the code is
 * selected for a manual copy. `name` makes each button's accessible name unique in a list.
 */
export function InviteCodeCopy({
  value: known = null,
  load,
  loadErrorText,
  texts,
  name,
  layout = 'row',
}: {
  readonly value?: InviteCodeValue | null;
  readonly load?: () => Promise<Result<InviteCodeValue, AppError>>;
  /** The message for a refused `load` (e.g. not allowed, no code any more). */
  readonly loadErrorText?: (error: AppError) => string;
  readonly texts: InviteCopyTexts;
  /** The invitee's name, for the buttons' accessible names in a list. */
  readonly name?: string;
  readonly layout?: 'row' | 'panel';
}) {
  const [loaded, setLoaded] = useState<InviteCodeValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const codeRef = useRef<HTMLElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const value = known ?? loaded;

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  /** Clears the live region, then sets the text: the same message is announced again. */
  const announce = (text: string) => {
    window.clearTimeout(timer.current);
    setAnnouncement('');
    timer.current = window.setTimeout(() => {
      setAnnouncement(text);
    }, 100);
  };

  const current = async (): Promise<InviteCodeValue | null> => {
    if (value) return value;
    if (!load) return null;
    setBusy(true);
    announce(texts.loading);
    try {
      const answer = await load();
      if (!answer.ok) {
        announce(loadErrorText ? loadErrorText(answer.error) : texts.copyFailed);
        return null;
      }
      setLoaded(answer.value);
      return answer.value;
    } finally {
      setBusy(false);
    }
  };

  const copy = async (what: 'code' | 'link') => {
    const target = await current();
    if (!target) return;
    const ok = await copyText(
      what === 'code' ? displayInviteCode(target.inviteCode) : linkOf(target),
    );
    if (ok) {
      announce(what === 'code' ? texts.codeCopied : texts.linkCopied);
      return;
    }
    announce(texts.copyFailed);
    // Shown by now (a loaded code renders on the next paint): select it for a manual copy.
    window.setTimeout(() => {
      const node = codeRef.current;
      const selection = window.getSelection();
      if (node && selection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }, 0);
  };

  const suffix = name ? <span className="sr-only">{` (${name})`}</span> : null;
  return (
    <div className={layout === 'panel' ? 'flex flex-col gap-3' : 'flex flex-col gap-1'}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-md bg-surface-sunken py-1 pe-1 ps-3">
          {value ? (
            <>
              <span className="sr-only">{texts.codeLabel}: </span>
              <code
                ref={codeRef}
                dir="ltr"
                className={
                  layout === 'panel'
                    ? 'font-mono text-2xl font-semibold tracking-[0.15em] text-text'
                    : 'font-mono text-sm font-semibold tracking-[0.1em] text-text'
                }
                data-testid="invite-code"
              >
                {displayInviteCode(value.inviteCode)}
              </code>
            </>
          ) : (
            // Not read yet: the code is fetched (and audited) when it is copied.
            <code
              dir="ltr"
              aria-hidden="true"
              className="font-mono text-sm font-semibold tracking-[0.1em] text-text-muted"
              data-testid="invite-code-hidden"
            >
              ••••-••••-••••
            </code>
          )}
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-60 pointer-fine:size-8"
            title={texts.copyCode}
            disabled={busy}
            onClick={() => {
              void copy('code');
            }}
            data-testid="copy-invite-code"
          >
            <AuthIcon name="copy" />
            <span className="sr-only">
              {texts.copyCode}
              {name ? ` (${name})` : ''}
            </span>
          </button>
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => {
            void copy('link');
          }}
          data-testid="copy-invite-link"
        >
          <AuthIcon name="link" />
          {texts.copyLink}
          {suffix}
        </Button>
      </div>
      {/* Kept rendered so each outcome is announced when its text changes. */}
      <p
        role="status"
        aria-live="polite"
        className="m-0 min-h-5 text-sm text-text-muted"
        data-testid="invite-copy-status"
      >
        {announcement}
      </p>
    </div>
  );
}
