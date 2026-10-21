import { type PasswordRuleState, withMin } from '../../lib/password-rules';

/**
 * One live password rule as a chip (direction C): a ring that turns into a green tick when the rule is
 * met, plus its state for screen readers. The text says it; the colour only supports it.
 */
function RuleItem({ met, label, state }: { met: boolean; label: string; state: string }) {
  return (
    <li
      className={`inline-flex items-center gap-1.5 rounded-full border py-1 pe-3 ps-2 text-[13px] font-medium ${
        met
          ? 'border-success/50 bg-success-subtle text-success'
          : 'border-border bg-surface-sunken text-text-muted'
      }`}
    >
      <span
        aria-hidden="true"
        className={`grid size-4.5 shrink-0 place-items-center rounded-full border-[1.5px] ${
          met ? 'border-success bg-success text-surface' : 'border-border-strong'
        }`}
      >
        {met ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            focusable="false"
          >
            <path d="M5 12l5 5 9-10" />
          </svg>
        ) : null}
      </span>
      <span>
        {label} <span className="sr-only">{state}</span>
      </span>
    </li>
  );
}

export interface PasswordRuleLabels {
  readonly rulesLabel: string;
  /** With `{min}`: the minimum in force (12, or the organization's longer rule — T-M2-10). */
  readonly ruleMinLength: string;
  readonly ruleMaxBytes: string;
  readonly ruleMatches: string;
  readonly ruleMet: string;
  readonly ruleNotMet: string;
}

/**
 * The live password rules (the minimum length, at most 72 bytes, both entries match) shown while a
 * password is chosen — invitation acceptance (screen 8), password reset (screen 11) and My profile.
 */
export function PasswordRulesList({
  id,
  rules,
  labels,
}: {
  readonly id: string;
  readonly rules: PasswordRuleState;
  readonly labels: PasswordRuleLabels;
}) {
  return (
    <ul
      id={id}
      aria-label={labels.rulesLabel}
      aria-live="polite"
      className="m-0 flex list-none flex-wrap gap-2 p-0"
    >
      {(
        [
          [rules.minLength, withMin(labels.ruleMinLength, rules.min)],
          [rules.maxBytes, labels.ruleMaxBytes],
          [rules.matches, labels.ruleMatches],
        ] as const
      ).map(([met, label]) => (
        <RuleItem
          key={label}
          met={met}
          label={label}
          state={met ? labels.ruleMet : labels.ruleNotMet}
        />
      ))}
    </ul>
  );
}
