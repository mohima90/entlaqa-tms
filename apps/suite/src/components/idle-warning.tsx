'use client';
import { Button } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import { signOutAction } from '../auth/actions';
import { keepSessionAliveAction } from '../actions/session';

/**
 * Screen 6: «ننبّه المستخدم قبل الانتهاء بدقيقتين ليختار المتابعة» (T-M2-10). The organization's
 * inactivity limit is enforced by the database (activity = requests that reach it); this page counts the
 * time since it was loaded or last kept alive, warns two minutes before the limit and then sends the
 * member to sign-in, where the ended session is signed out. "Stay signed in" is a request (activity).
 */
export function IdleWarning({
  locale,
  idleMinutes,
  texts,
}: {
  readonly locale: string;
  readonly idleMinutes: number;
  readonly texts: {
    readonly title: string;
    readonly text: string;
    readonly stay: string;
    readonly signOut: string;
  };
}) {
  const router = useRouter();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [lastActive, setLastActive] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const limitMs = idleMinutes * 60_000;
  const warnMs = Math.max(limitMs - 120_000, limitMs / 2);

  useEffect(() => {
    const warn = window.setTimeout(() => {
      if (!dialog.current?.open) dialog.current?.showModal();
    }, warnMs);
    const end = window.setTimeout(() => {
      router.replace(`/${locale}/sign-in?notice=session-ended`);
      router.refresh();
    }, limitMs);
    return () => {
      window.clearTimeout(warn);
      window.clearTimeout(end);
    };
  }, [lastActive, limitMs, warnMs, locale, router]);

  const stay = useCallback(() => {
    startTransition(async () => {
      const result = await keepSessionAliveAction({});
      dialog.current?.close();
      if (result.ok) setLastActive(Date.now());
      else router.refresh(); // the session already ended: the page sends the member on
    });
  }, [router]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="max-w-md rounded-lg border border-border bg-surface p-6 text-text shadow-lg backdrop:bg-black/40"
      data-testid="idle-warning"
    >
      <h2 id={titleId} className="m-0 mb-2 text-lg font-semibold">
        {texts.title}
      </h2>
      <p className="m-0 mb-4">{texts.text}</p>
      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={stay} disabled={pending}>
          {texts.stay}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              await signOutAction({});
              router.replace(`/${locale}/sign-in`);
              router.refresh();
            });
          }}
        >
          {texts.signOut}
        </Button>
      </div>
    </dialog>
  );
}
