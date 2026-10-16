'use client';
import { Button } from '@jadarat/ui';
import { useRef, useState } from 'react';
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
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kawadir's invite code chip (PO, 16 Oct 2026): the code in a monospace chip with «نسخ الرمز» / "Copy
 * code", and «نسخ الرابط» / "Copy invite link" — the app's own origin, the invitation's language and the
 * code in the URL fragment (`/{locale}/sign-up#code=…`). Copying changes nothing on the server (not a
 * resend). The outcome is announced (aria-live); when the browser refuses the clipboard, the code is
 * selected for a manual copy. `name` makes each button's accessible name unique in a list.
 */
export function InviteCodeCopy({
  code,
  locale,
  texts,
  name,
  layout = 'row',
}: {
  readonly code: string;
  readonly locale: 'ar' | 'en';
  readonly texts: InviteCopyTexts;
  /** The invitee's name, for the buttons' accessible names in a list. */
  readonly name?: string;
  readonly layout?: 'row' | 'panel';
}) {
  const [announcement, setAnnouncement] = useState('');
  const codeRef = useRef<HTMLElement>(null);

  const copy = async (what: 'code' | 'link') => {
    const ok = await copyText(
      what === 'code' ? code : inviteLink(window.location.origin, locale, code),
    );
    if (ok) {
      setAnnouncement(what === 'code' ? texts.codeCopied : texts.linkCopied);
      return;
    }
    setAnnouncement(texts.copyFailed);
    const node = codeRef.current;
    const selection = window.getSelection();
    if (node && selection) {
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  const suffix = name ? <span className="sr-only">{` (${name})`}</span> : null;
  return (
    <div className={layout === 'panel' ? 'flex flex-col gap-3' : 'flex flex-col gap-1'}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-md bg-surface-sunken py-1 pe-1 ps-3">
          <span className="sr-only">{texts.codeLabel}: </span>
          <code
            ref={codeRef}
            dir="ltr"
            className={
              layout === 'panel'
                ? 'font-mono text-2xl font-semibold tracking-[0.25em] text-text'
                : 'font-mono text-sm font-semibold tracking-[0.15em] text-text'
            }
            data-testid="invite-code"
          >
            {code}
          </code>
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text pointer-fine:size-8"
            title={texts.copyCode}
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
      <p role="status" aria-live="polite" className="m-0 min-h-5 text-sm text-text-muted">
        {announcement}
      </p>
    </div>
  );
}
