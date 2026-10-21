import type { ReactNode } from 'react';
import { buttonClasses } from './button';
import { cn } from './cn';
import { Icon } from './icons';

/** The bar's own buttons on its dark pill (not `buttonClasses`: their colours differ there). */
const PILL =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-full border-[1.5px] px-3.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-70 pointer-coarse:min-h-11';

export type SaveBarState = 'idle' | 'unsaved' | 'saving' | 'saved';

export interface SaveBarProps {
  readonly state: SaveBarState;
  readonly texts: {
    /** «لديك تغييرات لم تُحفظ.» / "You have unsaved changes." */
    readonly unsaved: string;
    /** «جارٍ الحفظ…» / "Saving…" */
    readonly saving: string;
    /** E.g. «آخر تعديل بواسطة …» / "Last changed by … on …" (the saved state). */
    readonly saved: ReactNode;
    readonly save: string;
    readonly cancel: string;
  };
  /** The form the Save button submits (the bar sits outside it, at the bottom of the screen). */
  readonly form: string;
  /** Discards the changes (a reset of the form). */
  readonly onCancel?: (() => void) | undefined;
}

/**
 * The floating save bar of a settings form (direction C, redesign package 1): at rest a quiet card with
 * when the settings last changed; with unsaved changes a dark pill at the bottom centre — the message,
 * Cancel and Save; while saving, Save is busy. The message is a polite live region (the text changes,
 * the region stays). Save submits the form by id, so the form's own validation and server action run
 * unchanged. Not shown when the member may only read the settings.
 */
export function SaveBar({ state, texts, form, onCancel }: SaveBarProps) {
  const active = state === 'unsaved' || state === 'saving';
  return (
    <div className="pointer-events-none sticky bottom-4 z-20 mt-6 flex justify-center">
      <div
        data-state={state}
        data-testid="save-bar"
        className={cn(
          'pointer-events-auto flex max-w-full flex-wrap items-center gap-3 rounded-full py-2.5 pe-2.5 ps-5',
          active
            ? 'bg-inverse-surface text-inverse-text shadow-4'
            : 'border border-border bg-surface text-text-muted shadow-2',
        )}
      >
        <p role="status" className="m-0 flex items-center gap-2 text-[14.5px]">
          <Icon name={active ? 'info' : 'success'} className="size-4" />
          <span>
            {state === 'unsaved' ? texts.unsaved : state === 'saving' ? texts.saving : texts.saved}
          </span>
        </p>
        <div className="flex gap-2">
          <button
            type="reset"
            form={form}
            onClick={onCancel}
            disabled={!active || state === 'saving'}
            className={
              active
                ? cn(
                    PILL,
                    'border-inverse-text/60 bg-transparent text-inverse-text hover:bg-inverse-text/15',
                  )
                : buttonClasses({ variant: 'secondary', size: 'sm' })
            }
          >
            {texts.cancel}
          </button>
          <button
            type="submit"
            form={form}
            aria-busy={state === 'saving' || undefined}
            className={
              active
                ? cn(PILL, 'border-transparent bg-surface text-text hover:bg-surface-hover')
                : buttonClasses({ variant: 'primary', size: 'sm' })
            }
          >
            {texts.save}
          </button>
        </div>
      </div>
    </div>
  );
}
