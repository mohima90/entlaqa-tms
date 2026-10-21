import { Icon } from '@jadarat/ui';
import type { ImportStep } from '../../lib/user-import-view';
import { IMPORT_STEPS } from '../../lib/user-import-view';

export interface StepperProps {
  readonly current: ImportStep;
  /** Step names in order, and the texts «(مكتملة)», «الخطوة 3 من 4 · المراجعة». */
  readonly names: Readonly<Record<ImportStep, string>>;
  readonly label: string;
  readonly doneText: string;
  readonly shortText: string;
}

/**
 * The import's step bar (design README §13; redesign package 3 — Remote's step chips): File · Column
 * mapping · Review · Confirmation as pills in the focused frame's top bar — done steps with a tick, the
 * current one on the brand gradient. An ordered list with `aria-current="step"`, done steps announced as
 * «(مكتملة)»; on phones one line «الخطوة 3 من 4 · المراجعة».
 */
export function Stepper({ current, names, label, doneText, shortText }: StepperProps) {
  const index = IMPORT_STEPS.indexOf(current);
  return (
    <nav aria-label={label} data-testid="import-stepper">
      <p className="m-0 text-sm font-semibold md:hidden">{shortText}</p>
      <ol className="m-0 hidden list-none flex-wrap items-center gap-2 p-0 md:flex">
        {IMPORT_STEPS.map((step, i) => {
          const done = i < index;
          const isCurrent = i === index;
          return (
            <li
              key={step}
              aria-current={isCurrent ? 'step' : undefined}
              className={`flex min-h-10 items-center gap-2 rounded-full border py-1 pe-3.5 ps-1.5 text-[14.5px] font-medium ${
                isCurrent
                  ? 'border-transparent bg-brand-gradient text-on-brand shadow-brand-glow'
                  : 'border-border bg-surface text-text'
              }`}
            >
              <span
                aria-hidden="true"
                className={`grid size-7 place-items-center rounded-full text-xs font-bold ${
                  done
                    ? 'bg-success text-on-brand'
                    : isCurrent
                      ? 'border-[1.5px] border-current'
                      : 'border-[1.5px] border-border-strong text-text-muted'
                }`}
              >
                {done ? <Icon name="check" className="size-4" /> : String(i + 1)}
              </span>
              <span>{names[step]}</span>
              {done ? <span className="sr-only">{doneText}</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
