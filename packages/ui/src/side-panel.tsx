'use client';

import { type ReactNode, useEffect, useId, useRef } from 'react';
import { cn } from './cn';
import { Icon } from './icons';

export interface SidePanelProps {
  readonly open: boolean;
  /** Called when the panel closes itself: Escape, the close button or a click on the backdrop. */
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** «إغلاق» / "Close". */
  readonly closeLabel: string;
  /** The panel's buttons (Cancel, Save) and, e.g., the audit note — at the bottom, always visible. */
  readonly footer?: ReactNode;
  readonly children?: ReactNode;
  /** `md` 440 px (look at or change one thing); `lg` 600 px (a form: edit details, invite). */
  readonly size?: 'md' | 'lg' | undefined;
  /**
   * Asked before the panel closes itself (Escape, the close button, the backdrop): false keeps it open —
   * e.g. to ask «Discard your changes?» first (redesign package 3). The caller then closes it with `open`.
   */
  readonly canClose?: (() => boolean) | undefined;
  readonly 'data-testid'?: string | undefined;
}

/**
 * A side panel (direction C, redesign package 1) to look at or edit one item without leaving the list:
 * it slides over the page at the inline end (right in English, left in Arabic), full height, with a
 * header, a scrolling body and a footer that stays in view. Use it for an edit that needs a few fields
 * and the list as context; use `Dialog` for a confirmation or a single question, and a full page for
 * long forms or several steps (docs/design/redesign-direction-c.md). Built on the native `<dialog>`
 * (modal: the page behind is inert, Tab stays inside, Escape closes, focus returns to the opener).
 */
export function SidePanel({
  open,
  onClose,
  title,
  description,
  closeLabel,
  footer,
  children,
  size = 'md',
  canClose,
  'data-testid': testId,
}: SidePanelProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const onNativeClose = () => {
      opener.current?.focus();
      opener.current = null;
      onClose();
    };
    const onBackdrop = (event: MouseEvent) => {
      if (event.target === dialog && (!canClose || canClose())) dialog.close();
    };
    // Escape: the browser's `cancel` comes first and can be refused.
    const onCancel = (event: Event) => {
      if (canClose && !canClose()) event.preventDefault();
    };
    dialog.addEventListener('close', onNativeClose);
    dialog.addEventListener('click', onBackdrop);
    dialog.addEventListener('cancel', onCancel);
    return () => {
      dialog.removeEventListener('close', onNativeClose);
      dialog.removeEventListener('click', onBackdrop);
      dialog.removeEventListener('cancel', onCancel);
    };
  }, [onClose, canClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      data-testid={testId}
      className={cn(
        'fixed inset-y-2.5 end-2.5 start-auto m-0 h-auto max-h-none max-w-[calc(100%-1.25rem)] overflow-hidden rounded-xl border border-border bg-surface-raised p-0 text-text shadow-4 backdrop:bg-overlay',
        // Wider than before (role-play feedback #5, PO 27 Oct 2026): room for one field per row.
        size === 'lg' ? 'w-[720px]' : 'w-[560px]',
        'open:flex open:flex-col',
      )}
    >
      <div className="flex items-start gap-3 border-b border-border px-5.5 pb-4 pt-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={titleId} className="m-0 text-[19px] font-bold leading-tight">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="m-0 text-sm text-text-muted">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={closeLabel}
          onClick={() => {
            if (!canClose || canClose()) ref.current?.close();
          }}
          className="-me-2 -mt-1 grid size-10 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-auto px-5.5 py-4.5">{children}</div>
      {footer ? (
        <div className="flex flex-wrap items-center gap-2.5 border-t border-border px-5.5 py-3.5">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}

export interface FormSectionProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Heading level of the title (keeps the outline correct). */
  readonly headingLevel?: 2 | 3 | undefined;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}

/**
 * A section of a settings form (direction C): a card with the section's title and what it is for on
 * the inline-start side, and its fields in two columns beside it (one column on narrow screens).
 */
export function FormSection({
  title,
  description,
  headingLevel = 2,
  children,
  className,
}: FormSectionProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section
      className={cn(
        'grid grid-cols-1 gap-x-8 gap-y-6 rounded-xl border border-border bg-surface px-7 py-6.5 lg:grid-cols-[260px_minmax(0,1fr)]',
        className,
      )}
    >
      <div>
        <Heading className="m-0 text-lg font-bold">{title}</Heading>
        {description ? <p className="m-0 mt-1.5 text-sm text-text-muted">{description}</p> : null}
      </div>
      <div className="grid grid-cols-1 gap-4.5 md:grid-cols-2">{children}</div>
    </section>
  );
}
