'use client';
import type { ScopeUnitChoice } from '../../lib/structure-view';
import { SelectField } from '../select-field';

export interface ScopeUnitTexts {
  readonly label: string;
  readonly hint: string;
  readonly placeholder: string;
  /** Appended to units that cannot be picked («غير نشطة»). */
  readonly inactive: string;
  /** Why the list is empty: the organization has no units yet, or the giver cannot see the structure. */
  readonly none: string;
}

export interface ScopeUnitSelectProps {
  readonly id: string;
  readonly value: string;
  readonly onChange: (unitId: string) => void;
  readonly choices: readonly ScopeUnitChoice[];
  readonly texts: ScopeUnitTexts;
  readonly marker?: string | undefined;
  readonly error?: string | undefined;
  readonly disabled?: boolean;
}

/**
 * The unit of a custom role limited to «A department» (FR-IAM-08, T-M3-09; business flow EP-ORG BR-ORG-d,
 * PO 17 Oct 2026; Kawadir's department picker on invite / edit role): ONE unit of the structure, at any
 * level, in tree order (indented, with its level's name); the person sees it and everything under it.
 * Inactive units stay listed but disabled, with the reason in their text (screen readers read it).
 */
export function ScopeUnitSelect({
  id,
  value,
  onChange,
  choices,
  texts,
  marker,
  error,
  disabled,
}: ScopeUnitSelectProps) {
  return (
    <SelectField
      id={id}
      label={texts.label}
      marker={marker}
      hint={choices.length === 0 ? texts.none : texts.hint}
      error={error}
      value={value}
      required
      disabled={disabled === true || choices.length === 0}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      data-testid={`${id}-select`}
    >
      <option value="" disabled>
        {texts.placeholder}
      </option>
      {choices.map((choice) => (
        <option key={choice.id} value={choice.id} disabled={!choice.active}>
          {choice.active ? choice.label : `${choice.label} · ${texts.inactive}`}
        </option>
      ))}
    </SelectField>
  );
}
