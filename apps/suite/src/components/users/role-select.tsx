'use client';
import type { RoleOption } from '../../lib/role-choice';
import { SelectField } from '../select-field';

export interface RoleSelectTexts {
  readonly label: string;
  readonly placeholder: string;
  readonly standardGroup: string;
  readonly customGroup: string;
  /** Appended to privileged roles («دور مميز»). */
  readonly privileged: string;
  /** Appended to roles the member may not give («لا يمكنك إسناده»). */
  readonly notAllowed: string;
}

export interface RoleSelectProps {
  readonly id: string;
  readonly value: string;
  readonly onChange: (code: string) => void;
  readonly options: readonly RoleOption[];
  readonly texts: RoleSelectTexts;
  readonly marker?: string | undefined;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly disabled?: boolean;
}

/**
 * One role per person (EP-ROLES; Kawadir's role dropdown): a native select with the standard roles, then
 * the organization's custom roles. Roles the member may not give stay listed but disabled, with the
 * reason in their text (screen readers read it); privileged roles say so.
 */
export function RoleSelect({
  id,
  value,
  onChange,
  options,
  texts,
  marker,
  hint,
  error,
  disabled,
}: RoleSelectProps) {
  const option = (role: RoleOption) => {
    const suffix = [
      role.privileged ? texts.privileged : null,
      role.assignable ? null : texts.notAllowed,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <option key={role.code} value={role.code} disabled={!role.assignable}>
        {suffix ? `${role.name} (${suffix})` : role.name}
      </option>
    );
  };
  const standard = options.filter((o) => o.kind === 'standard');
  const custom = options.filter((o) => o.kind === 'custom');
  return (
    <SelectField
      id={id}
      label={texts.label}
      marker={marker}
      hint={hint}
      error={error}
      value={value}
      required
      disabled={disabled}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      data-testid={`${id}-select`}
    >
      <option value="" disabled>
        {texts.placeholder}
      </option>
      <optgroup label={texts.standardGroup}>{standard.map(option)}</optgroup>
      {custom.length > 0 ? (
        <optgroup label={texts.customGroup}>{custom.map(option)}</optgroup>
      ) : null}
    </SelectField>
  );
}
