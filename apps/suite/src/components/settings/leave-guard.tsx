'use client';
import { Button, Dialog } from '@jadarat/ui';
import { useEffect, useRef, useState } from 'react';
import { guardedHref } from '../../lib/leave-guard';
import type { SettingsCommonTexts } from './settings-texts';

/**
 * Warns before leaving a settings page with unsaved changes (redesign package 2, PO answer Q2-2,
 * 21 Oct 2026): only while there are unsaved edits. A link inside the site opens «Leave without saving?»
 * (Stay on this page / Leave without saving); reloading or closing the tab gets the browser's own
 * question (`beforeunload`). Nothing is saved or discarded by the guard itself.
 */
export function LeaveGuard({
  active,
  texts,
}: {
  readonly active: boolean;
  readonly texts: Pick<
    SettingsCommonTexts,
    'leaveTitle' | 'leaveText' | 'leaveStay' | 'leaveGo' | 'close'
  >;
}) {
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const leaving = useRef(false);

  useEffect(() => {
    if (!active) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leaving.current) return;
      event.preventDefault();
    };
    // Capture phase on the document: before the router's own link handling.
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement)) return;
      const href = guardedHref(
        {
          defaultPrevented: event.defaultPrevented,
          button: event.button,
          modified: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
          href: link.href,
          target: link.target,
          download: link.hasAttribute('download'),
        },
        window.location,
      );
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingHref(href);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [active]);

  return (
    <Dialog
      open={pendingHref !== null}
      onClose={() => {
        setPendingHref(null);
      }}
      title={texts.leaveTitle}
      description={texts.leaveText}
      closeLabel={texts.close}
      tone="warning"
      size="sm"
      data-testid="leave-guard"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              if (!pendingHref) return;
              leaving.current = true;
              window.location.assign(pendingHref);
            }}
            data-testid="leave-guard-leave"
          >
            {texts.leaveGo}
          </Button>
          <Button
            onClick={() => {
              setPendingHref(null);
            }}
            data-testid="leave-guard-stay"
          >
            {texts.leaveStay}
          </Button>
        </>
      }
    />
  );
}
