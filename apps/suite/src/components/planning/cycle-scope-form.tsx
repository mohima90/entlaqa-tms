'use client';
import { savePlanCycleScopeAction } from '@jadarat/tms/actions/planning';
import { departmentsInScope, effectiveHead } from '@jadarat/tms/planning-rules';
import { Alert, Badge, Card, EmptyState } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useMemo, useState, useTransition } from 'react';
import { cycleHref } from '../../lib/planning-view';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { StepFooter } from './cycle-chain-forms';
import { useUnsavedStep } from './setup-step-nav';
import { usePlanningTexts } from './use-planning-texts';

const sameSet = (set: ReadonlySet<string>, list: readonly string[]) =>
  set.size === list.length && list.every((id) => set.has(id));

export interface ScopeUnit {
  readonly id: string;
  readonly parentId: string | null;
  readonly branchId: string | null;
  readonly name: string;
  readonly depth: number;
  readonly active: boolean;
  readonly hasHead: boolean;
}

export interface CycleScopeFormProps {
  readonly locale: 'ar' | 'en';
  readonly cycle: { readonly id: string; readonly version: number };
  readonly units: readonly ScopeUnit[];
  readonly branches: readonly {
    readonly id: string;
    readonly name: string;
    readonly active: boolean;
  }[];
  readonly initial: {
    readonly departmentIds: readonly string[];
    readonly branchIds: readonly string[];
  };
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly backHref: string;
}

/** Indentation per level of the structure (logical property: mirrors in Arabic). */
const INDENT = ['ps-0', 'ps-6', 'ps-12', 'ps-18', 'ps-24'] as const;

/**
 * Step 2 — Scope (EP-PLN B4): departments (any level; a unit includes everything under it) and branches
 * (all their departments). Shows how many needs forms will be sent — one per department in scope — and
 * warns about departments whose form reaches no head (EP-ORG: the nearest head above receives it).
 */
export function CycleScopeForm(props: CycleScopeFormProps) {
  const { t, message } = usePlanningTexts(props.texts, props.errors, props.locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [departments, setDepartments] = useState<ReadonlySet<string>>(
    new Set(props.initial.departmentIds),
  );
  const [branches, setBranches] = useState<ReadonlySet<string>>(new Set(props.initial.branchIds));
  const [notice, setNotice] = useState<string | null>(null);
  useUnsavedStep(
    !sameSet(departments, props.initial.departmentIds) ||
      !sameSet(branches, props.initial.branchIds),
  );

  const structure = useMemo(
    () =>
      props.units.map((unit, index) => ({
        id: unit.id,
        parentId: unit.parentId,
        branchId: unit.branchId,
        active: unit.active,
        sortOrder: index,
        nameAr: unit.name,
        headPersonId: unit.hasHead ? unit.id : null,
      })),
    [props.units],
  );
  const inScope = departmentsInScope(structure, {
    departmentIds: [...departments],
    branchIds: [...branches],
  });
  const withoutHead = inScope.filter((id) => effectiveHead(structure, id) === null).length;

  const toggle = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    startTransition(async () => {
      const result = await savePlanCycleScopeAction({
        id: props.cycle.id,
        version: props.cycle.version,
        departmentIds: [...departments],
        branchIds: [...branches],
      });
      if (result.ok) {
        router.push(cycleHref(props.locale, props.cycle.id, 'budget'));
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      setNotice(message(result.error));
    });
  }

  if (props.units.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="building"
          title={t('setup.scope.title')}
          description={t('setup.scope.noStructure')}
        />
      </Card>
    );
  }

  const summary = (
    <div
      className="flex flex-col gap-3 rounded-[20px] border border-border bg-surface-sunken p-5 xl:sticky xl:top-24"
      aria-live="polite"
      data-testid="scope-summary"
    >
      <span aria-hidden="true" className="text-[40px] font-bold leading-none tabular-nums">
        {String(inScope.length)}
      </span>
      <p className="m-0 font-semibold" data-testid="scope-forms-count">
        {t('setup.scope.formsTitle', { count: inScope.length })}
      </p>
      <p className="m-0 text-sm text-text-muted">{t('setup.scope.formsHint')}</p>
      {withoutHead > 0 ? (
        <Alert tone="warning" data-testid="scope-no-head">
          {t('setup.scope.noHeadWarning', { count: withoutHead })}
        </Alert>
      ) : null}
    </div>
  );

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" data-testid="cycle-scope">
      {notice ? <Alert tone="danger">{notice}</Alert> : null}
      <Card title={t('setup.scope.title')} description={t('setup.scope.intro')}>
        <div className="grid grid-cols-1 items-start gap-5.5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-2 p-0 text-sm font-bold">{t('setup.scope.departments')}</legend>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0" data-testid="scope-units">
              {props.units.map((unit) => {
                const id = `scope-unit-${unit.id}`;
                const covered = inScope.includes(unit.id);
                return (
                  <li key={unit.id} className={INDENT[Math.min(unit.depth, INDENT.length - 1)]}>
                    <div
                      className={`flex min-h-12 items-center gap-3 rounded-xl px-2.5 hover:bg-surface-hover ${
                        unit.depth > 0
                          ? `rounded-s-none border-s-2 ${covered ? 'border-primary' : 'border-border'}`
                          : ''
                      }`}
                    >
                      <input
                        id={id}
                        type="checkbox"
                        checked={departments.has(unit.id)}
                        onChange={() => {
                          setDepartments((current) => toggle(current, unit.id));
                        }}
                        disabled={pending}
                        className="size-5 shrink-0 accent-primary"
                        data-testid="scope-unit"
                      />
                      <label
                        htmlFor={id}
                        className="flex flex-1 flex-wrap items-center gap-2 text-sm"
                      >
                        <span className={covered ? 'font-medium' : undefined}>{unit.name}</span>
                        {!unit.active ? (
                          <Badge tone="neutral">{t('setup.scope.inactive')}</Badge>
                        ) : null}
                        {!unit.hasHead ? (
                          <Badge tone="warning">{t('setup.scope.noHead')}</Badge>
                        ) : null}
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <div className="flex flex-col gap-5">
            {summary}
            {props.branches.length > 0 ? (
              <fieldset className="m-0 border-0 p-0" aria-describedby="scope-branches-hint">
                <legend className="mb-1 p-0 text-sm font-bold">{t('setup.scope.branches')}</legend>
                <p id="scope-branches-hint" className="m-0 mb-2 text-sm text-text-muted">
                  {t('setup.scope.branchesHint')}
                </p>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {props.branches.map((branch) => {
                    const id = `scope-branch-${branch.id}`;
                    return (
                      <li key={branch.id}>
                        <div className="flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-surface-hover">
                          <input
                            id={id}
                            type="checkbox"
                            checked={branches.has(branch.id)}
                            onChange={() => {
                              setBranches((current) => toggle(current, branch.id));
                            }}
                            disabled={pending}
                            className="size-5 shrink-0 accent-primary"
                            data-testid="scope-branch"
                          />
                          <label htmlFor={id} className="text-sm">
                            {branch.name}
                          </label>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ) : null}
          </div>
        </div>
      </Card>
      <StepFooter
        backHref={props.backHref}
        backLabel={t('setup.back')}
        saveLabel={t('setup.saveAndContinue')}
        workingLabel={t('setup.working')}
        pending={pending}
        testId="cycle-scope-save"
      />
    </form>
  );
}
