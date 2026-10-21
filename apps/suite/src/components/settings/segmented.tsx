import { cn } from '@jadarat/ui';
import type { ReactNode } from 'react';

/**
 * A segmented control (direction C, redesign package 2): a group of radio buttons drawn as one pill —
 * e.g. the default language or the date display. Each option is a real radio input stretched over its
 * segment (invisible), so clicks, the keyboard (arrow keys) and screen readers work as for radios; the
 * focus ring is drawn on the segment.
 */
export function Segmented<V extends string>({
  name,
  legend,
  legendExtra,
  value,
  options,
  disabled,
  onChange,
  describedBy,
  testIdPrefix,
}: {
  readonly name: string;
  readonly legend: ReactNode;
  /** After the legend, e.g. a «Suggested» tag. */
  readonly legendExtra?: ReactNode;
  readonly value: V;
  readonly options: readonly {
    readonly value: V;
    readonly label: ReactNode;
    readonly lang?: string | undefined;
  }[];
  readonly disabled?: boolean | undefined;
  readonly onChange: (value: V) => void;
  readonly describedBy?: string | undefined;
  /** data-testid of each input: `${testIdPrefix}-${value}`. */
  readonly testIdPrefix: string;
}) {
  return (
    <fieldset
      className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
      aria-describedby={describedBy}
    >
      <legend className="mb-1.5 flex flex-wrap items-center gap-1 p-0 text-sm font-semibold">
        {legend}
        {legendExtra}
      </legend>
      <div className="flex w-full flex-wrap gap-1 rounded-[22px] border-[1.5px] border-border-strong bg-surface p-1 sm:w-fit">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              lang={option.lang}
              className={cn(
                'relative flex min-h-10 flex-1 items-center justify-center rounded-full border-[1.5px] px-4 text-[15px] whitespace-nowrap transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus-ring sm:flex-none',
                checked
                  ? 'border-primary bg-primary-subtle font-semibold text-primary-text'
                  : 'border-transparent text-text-muted hover:text-text',
                disabled ? 'cursor-not-allowed' : 'cursor-pointer',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                disabled={disabled}
                onChange={() => {
                  onChange(option.value);
                }}
                className="absolute inset-0 m-0 size-full cursor-[inherit] appearance-none rounded-full opacity-0"
                data-testid={`${testIdPrefix}-${option.value}`}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
