'use client';
import type { ScopeSelection } from '@jadarat/tms/planning-rules';
import { Alert, Badge, FieldError, cn } from '@jadarat/ui';
import { useEffect, useId, useRef } from 'react';
import { type PickerUnit, allUnitsScope, unitPicks, unitsInScope } from '../../lib/planning-view';

type T = (key: string, values?: Readonly<Record<string, string | number>>) => string;

export interface ScopePickerProps {
  readonly units: readonly PickerUnit[];
  /**
   * The organization's branches, picked as well: a branch brings every department in it. They are always
   * shown where a scope is edited, so that a branch saved with the cycle is never dropped unseen.
   */
  readonly branches?:
    readonly { readonly id: string; readonly name: string; readonly active: boolean }[] | undefined;
  /** The longer summary of the cycle's Settings (what a form is; how many departments have no head). */
  readonly details?: boolean | undefined;
  readonly value: ScopeSelection;
  readonly onChange: (next: ScopeSelection) => void;
  readonly disabled: boolean;
  readonly error?: string | undefined;
  readonly t: T;
}

/** Indentation per level of the structure (logical property: mirrors in Arabic). */
const INDENT = ['ps-0', 'ps-6', 'ps-12', 'ps-18', 'ps-24'] as const;

const toggled = (list: readonly string[], id: string) =>
  list.includes(id) ? list.filter((other) => other !== id) : [...list, id];

/**
 * «Departments in this cycle» (EP-PLN B4; forms standard rule 9): every department of the structure with
 * its head — or «No head yet» —, «All departments» on top and the branches under them. A department
 * includes everything under it (PO, 17 Oct 2026): what comes with a ticked department above, or with a
 * ticked branch, shows ticked and is taken out by unticking that department or branch. «All departments»
 * unticked clears the departments and the branches shown here — never a branch the picker does not show.
 * One needs form per department in the cycle; the count is said as it changes.
 */
export function ScopePicker(props: ScopePickerProps) {
  const { t, units, value } = props;
  const id = useId();
  const master = useRef<HTMLInputElement>(null);
  const picks = unitPicks(units, value);
  const inScope = unitsInScope(units, value);
  const active = units.filter((unit) => unit.active);
  const all = active.length > 0 && inScope.length === active.length;
  const some = inScope.length > 0 && !all;
  const withoutHead = inScope.filter((unit) => unit.head === null).length;
  // Said once under the list when something can come with a department above or with a branch.
  const explains = units.some((unit) => unit.depth > 0) || [...picks.values()].includes('covered');
  const includedId = `${id}-included`;
  const errorId = `${id}-error`;
  const shownBranches = new Set((props.branches ?? []).map((branch) => branch.id));

  // «Some, not all» is a property of the checkbox, not an attribute.
  useEffect(() => {
    if (master.current) master.current.indeterminate = some;
  }, [some]);

  return (
    <div className="flex flex-col gap-4" data-testid="scope-picker">
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-sm font-semibold">{t('dialog.departments')}</legend>
        <label className="flex min-h-10 items-center gap-3 rounded-xl px-2.5 text-sm font-semibold hover:bg-surface-hover pointer-coarse:min-h-11">
          <input
            ref={master}
            type="checkbox"
            checked={all}
            onChange={() => {
              props.onChange(
                all
                  ? {
                      departmentIds: [],
                      branchIds: value.branchIds.filter((branch) => !shownBranches.has(branch)),
                    }
                  : { departmentIds: allUnitsScope(units), branchIds: value.branchIds },
              );
            }}
            disabled={props.disabled}
            // A refusal about the departments sits on the first control of the list (it takes the focus).
            aria-invalid={props.error ? true : undefined}
            aria-describedby={props.error ? errorId : undefined}
            className="size-5 shrink-0 accent-primary"
            data-testid="scope-all"
          />
          {t('dialog.allDepartments', { count: active.length })}
        </label>
        <ul
          className="m-0 flex max-h-64 list-none flex-col gap-0.5 overflow-y-auto rounded-xl border border-border p-1.5"
          data-testid="scope-units"
        >
          {units.map((unit) => {
            const pick = picks.get(unit.id) ?? 'out';
            const covered = pick === 'covered';
            return (
              <li key={unit.id} className={INDENT[Math.min(unit.depth, INDENT.length - 1)]}>
                <label
                  className={cn(
                    'flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2.5 py-1.5 text-sm hover:bg-surface-hover pointer-coarse:min-h-11',
                    unit.depth > 0 && 'border-s-2 border-border',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={pick !== 'out'}
                    onChange={() => {
                      props.onChange({
                        departmentIds: toggled(value.departmentIds, unit.id),
                        branchIds: value.branchIds,
                      });
                    }}
                    disabled={props.disabled || covered}
                    aria-describedby={covered ? includedId : undefined}
                    className="size-5 shrink-0 accent-primary"
                    data-testid="scope-unit"
                  />
                  <span className={pick === 'out' ? undefined : 'font-medium'}>{unit.name}</span>
                  {!unit.active ? (
                    <Badge tone="neutral">{t('setup.scope.inactive')}</Badge>
                  ) : unit.head === null ? (
                    <Badge tone="warning">{t('dialog.noHeadYet')}</Badge>
                  ) : (
                    <span className="text-[13px] text-text-muted">
                      {t('dialog.head', { name: unit.head })}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
        {explains ? (
          <p id={includedId} className="m-0 text-[13px] text-text-muted">
            {t('dialog.included')}
          </p>
        ) : null}
        {props.error ? <FieldError id={errorId}>{props.error}</FieldError> : null}
      </fieldset>

      {props.branches && props.branches.length > 0 ? (
        <fieldset className="m-0 border-0 p-0" aria-describedby={`${id}-branches-hint`}>
          <legend className="mb-1 p-0 text-sm font-semibold">{t('setup.scope.branches')}</legend>
          <p id={`${id}-branches-hint`} className="m-0 mb-2 text-[13px] text-text-muted">
            {t('setup.scope.branchesHint')}
          </p>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {props.branches.map((branch) => (
              <li key={branch.id}>
                <label className="flex min-h-10 items-center gap-3 rounded-xl px-2.5 text-sm hover:bg-surface-hover pointer-coarse:min-h-11">
                  <input
                    type="checkbox"
                    checked={value.branchIds.includes(branch.id)}
                    onChange={() => {
                      props.onChange({
                        departmentIds: value.departmentIds,
                        branchIds: toggled(value.branchIds, branch.id),
                      });
                    }}
                    disabled={props.disabled}
                    className="size-5 shrink-0 accent-primary"
                    data-testid="scope-branch"
                  />
                  {branch.name}
                  {!branch.active ? (
                    <Badge tone="neutral">{t('setup.scope.inactive')}</Badge>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-2" aria-live="polite" data-testid="scope-summary">
        <p className="m-0 text-sm font-semibold" data-testid="scope-forms-count">
          {t('setup.scope.formsTitle', { count: inScope.length })}
        </p>
        {props.details ? (
          <p className="m-0 text-[13px] text-text-muted">{t('setup.scope.formsHint')}</p>
        ) : null}
        {props.details && withoutHead > 0 ? (
          <Alert tone="warning" data-testid="scope-no-head">
            {t('setup.scope.noHeadWarning', { count: withoutHead })}
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
