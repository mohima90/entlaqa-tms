'use client';
import { Button, Dialog, StepList, type StepListItem } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

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
              onClick={() => {
                setLeaving(null);
              }}
            >
              {texts.keepEditing}
            </Button>
          </>
        }
      />
    </>
  );
}
