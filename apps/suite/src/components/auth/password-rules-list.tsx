import type { PasswordRuleState } from '../../lib/password-rules';

/** One live password rule: an icon plus its state for screen readers. */
function RuleItem({ met, label, state }: { met: boolean; label: string; state: string }) {
  return (
    <li className={`flex items-center gap-2 text-sm ${met ? 'text-success' : 'text-text-muted'}`}>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
        className="shrink-0"
      >
        {met ? <path d="M5 12l5 5 9-10" /> : <circle cx="12" cy="12" r="8" />}
      </svg>
      <span>
        {label} <span className="sr-only">{state}</span>
      </span>
    </li>
  );
}

export interface PasswordRuleLabels {
  readonly rulesLabel: string;
  readonly ruleMinLength: string;
  readonly ruleMaxBytes: string;
  readonly ruleMatches: string;
  readonly ruleMet: string;
  readonly ruleNotMet: string;
}

/**
 * The live password rules (12+ characters, at most 72 bytes, both entries match) shown while a
 * password is chosen — invitation acceptance (screen 8) and password reset (screen 11).
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
      className="m-0 flex list-none flex-col gap-1 p-0"
    >
      {(
        [
          [rules.minLength, labels.ruleMinLength],
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
