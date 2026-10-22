import type { ReactNode } from 'react';
import { buttonClasses } from './button';
import { cn } from './cn';
import { Icon } from './icons';

/** The bar's own buttons on its dark pill (not `buttonClasses`: their colours differ there). */
const PILL =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-full border-[1.5px] px-3.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-70 pointer-coarse:min-h-11';

/**
 * `idle` / `saved`: at rest (nothing to save); `unsaved`: changes waiting; `saving`: the save runs;
 * `invalid`: the last Save was refused by the checks — the message says so, with a way to the first field.
 */
export type SaveBarState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'invalid';

export interface SaveBarProps {
  readonly state: SaveBarState;
  readonly texts: {
    /** «لديك تغييرات لم تُحفظ.» / "You have unsaved changes." */
    readonly unsaved: string;
    /** «جارٍ الحفظ…» / "Saving…" */
    readonly saving: string;
    /** E.g. «آخر تعديل بواسطة …» / "Last changed by … on …" (the state at rest). */
    readonly saved: ReactNode;
    readonly save: string;
    readonly cancel: string;
    /** «بعض الحقول تحتاج إلى تصحيح…» / "Some fields need correcting…" (the `invalid` state). */
    readonly invalid?: string | undefined;
  };
  /** The form the Save button submits (the bar sits outside it, at the bottom of the screen). */
  readonly form: string;
  /** Discards the changes (a reset of the form). */
  readonly onCancel?: (() => void) | undefined;
  /** `invalid`: a way to the first field that needs correcting, e.g. «Go to Industry». */
  readonly fix?: { readonly label: string; readonly onClick: () => void } | undefined;
  /** More controls before the buttons (e.g. «Preview» on a phone). */
  readonly extra?: ReactNode;
  readonly className?: string | undefined;
}

/**
 * The floating save bar of a settings form (direction C, redesign packages 1–2): at rest a quiet card
 * with when the settings last changed and Save; with unsaved changes a dark pill at the bottom centre —
 * the message, Cancel and Save; while saving, Save is busy; after a refused Save, the message says
 * fields need correcting and offers the way to the first one. The message is a polite live region (the
 * text changes, the region stays). Save submits the form by id, so the form's own validation and server
 * action run unchanged. Not shown when the member may only read the settings.
 */
export function SaveBar({ state, texts, form, onCancel, fix, extra, className }: SaveBarProps) {
  const active = state === 'unsaved' || state === 'saving' || state === 'invalid';
  const message =
    state === 'unsaved'
      ? texts.unsaved
      : state === 'saving'
        ? texts.saving
        : state === 'invalid'
          ? (texts.invalid ?? texts.unsaved)
          : texts.saved;
  return (
    <div
      className={cn('pointer-events-none sticky bottom-4 z-20 mt-6 flex justify-center', className)}
    >
      <div
        data-state={state}
        data-testid="save-bar"
        className={cn(
          'pointer-events-auto flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-[28px] py-2.5 pe-2.5 ps-5',
          active
            ? 'bg-inverse-surface text-inverse-text shadow-4'
            : 'border border-border bg-surface text-text-muted shadow-2',
        )}
      >
        <p role="status" className="m-0 flex min-w-0 items-center gap-2 text-[14.5px]">
          <Icon
            name={state === 'invalid' ? 'error' : active ? 'info' : 'clock'}
            className="size-4 shrink-0"
          />
          <span data-testid="save-bar-message">{message}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {extra}
          {state === 'invalid' && fix ? (
            <button
              type="button"
              onClick={fix.onClick}
              className={cn(
                PILL,
                'border-transparent bg-transparent text-inverse-text underline underline-offset-3 hover:bg-inverse-text/15',
              )}
              data-testid="save-bar-fix"
            >
              {fix.label}
            </button>
          ) : null}
          {active && state !== 'invalid' ? (
            <button
              type="reset"
              form={form}
              onClick={onCancel}
              disabled={state === 'saving'}
              className={cn(
                PILL,
                'border-inverse-text/60 bg-transparent text-inverse-text hover:bg-inverse-text/15',
              )}
            >
              {texts.cancel}
            </button>
          ) : null}
          <button
            type="submit"
            form={form}
            disabled={state === 'saving'}
            aria-busy={state === 'saving' || undefined}
            className={
              active
                ? cn(PILL, 'border-transparent bg-surface text-text hover:bg-surface-hover')
                : buttonClasses({ variant: 'secondary', size: 'sm' })
            }
            data-testid="save-bar-save"
          >
            {texts.save}
          </button>
        </div>
      </div>
    </div>
  );
}
