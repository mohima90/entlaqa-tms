'use client';
import { Button, Dialog, StepList, type StepListItem } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';

/*
 * The set-up's side step list (redesign package 4) and the «Leave {step} without saving?» question: each
 * step form reports whether it has unsaved edits; following a step link with unsaved edits asks first,
 * «Keep editing» being the safe default. The steps still save only with their own «Save and continue».
 */

let dirty = false;

/** A step form says whether it has unsaved edits (cleared when it unmounts). */
export function useUnsavedStep(isDirty: boolean): void {
  useEffect(() => {
    dirty = isDirty;
    return () => {
      dirty = false;
    };
  }, [isDirty]);
}

export interface SetupStepNavProps {
  readonly label: string;
  readonly items: readonly StepListItem[];
  readonly current: string;
  readonly short: string;
  readonly texts: {
    /** «Leave Budget without saving?» (formatted on the server). */
    readonly leaveTitle: string;
    readonly leaveBody: string;
    readonly keepEditing: string;
    readonly discard: string;
    readonly close: string;
  };
}

export function SetupStepNav({ label, items, current, short, texts }: SetupStepNavProps) {
  const router = useRouter();
  const [leaving, setLeaving] = useState<string | null>(null);
  const keepId = useId();

  // The same question for the other ways out of the step inside the page (breadcrumb, Back, links in the
  // forms), and the browser's own warning when the tab is closed or reloaded with unsaved edits.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!dirty || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest<HTMLAnchorElement>('main a[href], a[data-leave-check]');
      if (!link || link.closest('[data-testid="setup-stepper"]')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || link.target === '_blank') return;
      event.preventDefault();
      setLeaving(`${url.pathname}${url.search}${url.hash}`);
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  // «Keep editing» is the safe default: it takes the focus when the question opens.
  useEffect(() => {
    if (leaving !== null) document.getElementById(keepId)?.focus();
  }, [leaving, keepId]);

  return (
    <>
      <StepList
        label={label}
        items={items}
        current={current}
        short={short}
        data-testid="setup-stepper"
        onNavigate={(event, href) => {
          if (!dirty || event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          setLeaving(href);
        }}
      />
      <Dialog
        open={leaving !== null}
        onClose={() => {
          setLeaving(null);
        }}
        title={texts.leaveTitle}
        description={texts.leaveBody}
        closeLabel={texts.close}
        tone="warning"
        size="sm"
        data-testid="setup-leave-dialog"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                const href = leaving;
                dirty = false;
                setLeaving(null);
                if (href) router.push(href);
              }}
              data-testid="setup-leave-discard"
            >
              {texts.discard}
            </Button>
            <Button
              id={keepId}
              onClick={() => {
                setLeaving(null);
              }}
              data-testid="setup-leave-keep"
            >
              {texts.keepEditing}
            </Button>
          </>
        }
      />
    </>
  );
}
