import type { MouseEvent } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';

export type StepListState = 'done' | 'problem' | 'todo' | 'locked';

export interface StepListItem {
  readonly key: string;
  readonly label: string;
  /** Where the step is; locked steps have none (shown, not reachable yet). */
  readonly href?: string | undefined;
  /** ✓ no problem · ! a problem belongs to it · a number · locked (dashed, not a link). */
  readonly state: StepListState;
  /** A short line under the name: «optional», «needs attention». */
  readonly note?: string | undefined;
  /** Said to screen readers after the name: «(completed)», «(needs attention)». */
  readonly srNote?: string | undefined;
  /** An icon instead of the number (the last step, e.g. a flag for «Review & launch»). */
  readonly icon?: IconName | undefined;
  readonly testId?: string | undefined;
}

export interface StepListProps {
  /** Names the navigation («خطوات الإعداد» / "Set-up steps"). */
  readonly label: string;
  readonly items: readonly StepListItem[];
  /** The `key` of the step shown now (`aria-current="step"`). */
  readonly current: string;
  /** Phones: one line, e.g. «Step 3 of 6 · Budget», above a segmented bar. */
  readonly short: string;
  /** Called before a step link is followed (e.g. to ask about unsaved changes); may prevent it. */
  readonly onNavigate?: ((event: MouseEvent<HTMLAnchorElement>, href: string) => void) | undefined;
  readonly className?: string | undefined;
  readonly 'data-testid'?: string | undefined;
}

/**
 * The steps of a task as a side list (direction C, redesign package 4 — Workable's set-up stepper): each
 * step a link with its number, ✓ when it has no problem, «!» with «needs attention» when one belongs to it,
 * «optional» under optional steps; locked steps are shown (the whole journey is visible) but are not
 * links. Sticky beside the step's form on wide screens; on phones one line «Step 3 of 6 · Budget» with a
 * segmented bar (the list is hidden). The marks are supported by words (`srNote`), never colour alone.
 */
export function StepList({
  label,
  items,
  current,
  short,
  onNavigate,
  className,
  'data-testid': testId,
}: StepListProps) {
  return (
    <nav aria-label={label} className={cn('lg:sticky lg:top-24', className)} data-testid={testId}>
      <div className="rounded-[18px] border border-border bg-surface px-4 py-3.5 lg:hidden">
        <p className="m-0 mb-2 font-semibold" data-testid="step-list-short">
          {short}
        </p>
        <div className="grid grid-flow-col gap-1" aria-hidden="true">
          {items.map((item) => (
            <i
              key={item.key}
              className={cn(
                'block h-1.5 rounded-full',
                item.key === current
                  ? 'bg-primary'
                  : item.state === 'done'
                    ? 'bg-success'
                    : item.state === 'problem'
                      ? 'bg-warning'
                      : 'bg-surface-hover',
              )}
            />
          ))}
        </div>
      </div>
      <ol className="m-0 hidden list-none flex-col gap-0.5 rounded-[22px] border border-border bg-surface p-2 lg:flex">
        {items.map((item, index) => {
          const isCurrent = item.key === current;
          const dot = (
            <span
              aria-hidden="true"
              className={cn(
                'relative z-[1] grid size-[34px] shrink-0 place-items-center rounded-full border-2 text-sm font-bold',
                isCurrent
                  ? 'border-transparent bg-brand-gradient text-on-brand shadow-brand-glow'
                  : item.state === 'done'
                    ? 'border-success bg-success text-surface'
                    : item.state === 'problem'
                      ? 'border-warning bg-warning-subtle text-warning'
                      : item.state === 'locked'
                        ? 'border-dashed border-border-strong bg-surface text-text-subtle'
                        : 'border-border-strong bg-surface text-text-muted',
              )}
            >
              {!isCurrent && item.state === 'done' ? (
                <Icon name="check" className="size-4" />
              ) : !isCurrent && item.state === 'problem' ? (
                '!'
              ) : item.icon ? (
                <Icon name={item.icon} className="size-4" />
              ) : (
                String(index + 1)
              )}
            </span>
          );
          const body = (
            <>
              {dot}
              <span className="min-w-0">
                <span
                  className={cn(
                    'block text-[15px] font-semibold leading-tight',
                    isCurrent && 'text-primary-text',
                  )}
                >
                  {item.label}
                </span>
                {item.note ? (
                  <span
                    aria-hidden={item.srNote ? true : undefined}
                    className={cn(
                      'block text-[12.5px]',
                      item.state === 'problem' ? 'font-semibold text-warning' : 'text-text-muted',
                    )}
                  >
                    {item.note}
                  </span>
                ) : null}
                {item.srNote ? <span className="sr-only"> {item.srNote}</span> : null}
              </span>
            </>
          );
          const row =
            'relative flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2 no-underline';
          return (
            <li
              key={item.key}
              className={cn(
                'relative',
                index > 0 &&
                  'before:absolute before:-top-2.5 before:start-[29px] before:h-[18px] before:border-s-2 before:border-border',
              )}
            >
              {item.state === 'locked' || !item.href ? (
                <span className={cn(row, 'text-text-subtle')} aria-disabled="true">
                  {body}
                </span>
              ) : (
                <a
                  href={item.href}
                  aria-current={isCurrent ? 'step' : undefined}
                  onClick={
                    onNavigate
                      ? (event) => {
                          onNavigate(event, item.href ?? '');
                        }
                      : undefined
                  }
                  className={cn(
                    row,
                    'text-text',
                    isCurrent ? 'bg-surface-selected' : 'hover:bg-surface-hover',
                  )}
                  data-testid={item.testId}
                >
                  {body}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
