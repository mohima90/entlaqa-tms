import type { ReactNode } from 'react';
import { cn } from './cn';

export interface ChoiceCardProps {
  readonly id: string;
  /** The radio group's name (all cards of one question share it). */
  readonly name: string;
  readonly value: string;
  readonly checked: boolean;
  readonly onChange: (value: string) => void;
  /** The choice's name, e.g. a role's name. */
  readonly title: ReactNode;
  /** What the choice means (muted, under the title; the radio is described by it). */
  readonly description?: ReactNode;
  /** Tags after the title («privileged», «Current role»). */
  readonly badges?: ReactNode;
  /** Why the choice cannot be picked now (shown when disabled; part of the description). */
  readonly note?: ReactNode;
  readonly disabled?: boolean | undefined;
  /** Shown inside the card while it is chosen (e.g. the unit a department-limited role covers). */
  readonly children?: ReactNode;
  readonly 'data-testid'?: string | undefined;
}

/**
 * One choice of a radio question as a card (direction C, redesign package 3 — Gusto's permission rows): a
 * radio, the choice's name with its tags and what it means; the chosen card is outlined in the brand colour
 * and may open extra fields inside it. A choice that cannot be picked stays listed, greyed, with the reason.
 * Native radios: arrow keys move between the cards of a group.
 */
export function ChoiceCard({
  id,
  name,
  value,
  checked,
  onChange,
  title,
  description,
  badges,
  note,
  disabled = false,
  children,
  'data-testid': testId,
}: ChoiceCardProps) {
  const describedBy = [description ? `${id}-description` : '', disabled && note ? `${id}-note` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div
      data-testid={testId}
      data-checked={checked || undefined}
      className={cn(
        'flex flex-col gap-3 rounded-lg border-[1.5px] px-4 py-3.5 transition-colors',
        checked ? 'border-primary bg-primary-subtle' : 'border-border bg-surface',
        disabled && 'bg-surface-sunken',
      )}
    >
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="radio"
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
          onChange={() => {
            onChange(value);
          }}
          aria-describedby={describedBy || undefined}
          className="mt-1 size-5 shrink-0 accent-primary"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <label
            htmlFor={id}
            className={cn(
              'flex flex-wrap items-center gap-2 font-semibold',
              disabled ? 'cursor-not-allowed text-text-muted' : 'cursor-pointer',
            )}
          >
            <span>{title}</span>
            {badges}
          </label>
          {description ? (
            <p id={`${id}-description`} className="m-0 text-sm text-text-muted">
              {description}
            </p>
          ) : null}
          {disabled && note ? (
            <p id={`${id}-note`} className="m-0 text-sm font-medium text-text-muted">
              {note}
            </p>
          ) : null}
        </div>
      </div>
      {checked && children ? <div className="ps-8">{children}</div> : null}
    </div>
  );
}
