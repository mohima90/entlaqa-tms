import type { ImportStep } from '../../lib/user-import-view';
import { IMPORT_STEPS } from '../../lib/user-import-view';

export interface StepperProps {
  readonly current: ImportStep;
  /** Step names in order, and the texts «(مكتملة)», «الخطوة 3 من 5 · المراجعة». */
  readonly names: Readonly<Record<ImportStep, string>>;
  readonly label: string;
  readonly doneText: string;
  readonly shortText: string;
}

/**
 * The wizard's steps (design README §13): an ordered list with `aria-current="step"`, done steps announced
 * as «(مكتملة)»; on phones one line «الخطوة 3 من 5 · المراجعة».
 */
export function Stepper({ current, names, label, doneText, shortText }: StepperProps) {
  const index = IMPORT_STEPS.indexOf(current);
  return (
    <nav aria-label={label} className="mb-6" data-testid="import-stepper">
      <p className="m-0 font-medium sm:hidden">{shortText}</p>
      <ol className="m-0 hidden list-none flex-wrap gap-2 p-0 sm:flex">
        {IMPORT_STEPS.map((step, i) => {
          const done = i < index;
          const isCurrent = i === index;
          return (
            <li
              key={step}
              aria-current={isCurrent ? 'step' : undefined}
              className={`flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm ${
                isCurrent
                  ? 'border-primary bg-surface-selected font-semibold text-primary-text'
                  : done
                    ? 'border-success bg-success-subtle text-text'
                    : 'border-border text-text-muted'
              }`}
            >
              <span
                aria-hidden="true"
                className="flex size-6 items-center justify-center rounded-full border border-current text-xs"
              >
                {done ? '✓' : String(i + 1)}
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
