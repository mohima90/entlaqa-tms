'use client';
import { deletePlanCycleAction, launchPlanCycleAction } from '@jadarat/tms/actions/planning';
import { LAUNCH_PROBLEMS, type LaunchProblem } from '@jadarat/tms/planning-rules';
import { Alert, Badge, Button, Dialog, Icon, buttonClasses, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { useSessionRefusal } from '../auth/session-refusal';
import type { CycleActionCommon as Common } from './extend-deadline-button';
import { usePlanningTexts } from './use-planning-texts';

/** A department that gets the needs form at launch, with the head who fills it in (null: nobody yet). */
export interface LaunchDepartment {
  readonly id: string;
  readonly name: string;
  readonly head: string | null;
}

export interface LaunchCycleDialogProps extends Common {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The cycle's name in the page's language. */
  readonly name: string;
  /** The needs deadline as the organization shows dates. */
  readonly deadline: string;
  /** One needs form each: the departments the cycle covers now, in the structure's order. */
  readonly departments: readonly LaunchDepartment[];
  /** What stops the launch today; the server checks again. */
  readonly problems: readonly LaunchProblem[];
  /** Where each problem is fixed: the «Edit» popup (deadline, departments) or the Settings (needs form). */
  readonly editHref: string;
  readonly settingsHref: string;
  /** Organization → Departments, for members who pick heads there; null: the HR Manager does. */
  readonly structureHref: string | null;
  /** Where to go once launched (the cycle's progress with its confirmation). */
  readonly launchedHref: string;
}

/** Departments without a head are named one by one up to this many; beyond it, they are counted. */
const NAMED_WITHOUT_HEAD = 3;

const PROBLEM_FIX: Readonly<Record<LaunchProblem, 'edit' | 'settings' | null>> = {
  deadline_past: 'edit',
  no_needs_form: 'settings',
  no_departments: 'edit',
  another_open: null,
};

/**
 * «Launch {name}?» (business flow B5; forms standard rule 9: launching is a row-menu action with a small
 * confirmation): how many departments get the needs form and until when, the departments with their heads,
 * and a warning for each department without a head — nobody can fill in its form; the launch does not wait
 * for it. What stops the launch (a passed deadline, no needs form, no department, another open cycle) is
 * listed with where to fix it, and «Launch» stays off until it is fixed. The server checks again.
 */
export function LaunchCycleDialog(props: LaunchCycleDialogProps) {
  const { t, actionMessage } = usePlanningTexts(props.texts, props.errors, props.locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const listId = useId();
  const withoutHead = props.departments.filter((department) => department.head === null);
  const blocked = props.problems.length > 0;

  function onLaunch() {
    setNotice(null);
    startTransition(async () => {
      const result = await launchPlanCycleAction(props.cycle);
      if (result.ok) {
        props.onClose();
        router.push(props.launchedHref);
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      // The server found something the page did not know yet: say what, and show the latest.
      const reasons =
        result.error.code === 'PLAN_CYCLE_NOT_READY'
          ? String(result.error.params?.reasons ?? '')
              .split(',')
              .filter((reason) => reason !== '')
          : [];
      if (reasons.length > 0) {
        setNotice(
          reasons
            .map((reason) =>
              (LAUNCH_PROBLEMS as readonly string[]).includes(reason)
                ? t(`setup.launch.problems.${reason}`)
                : t('setup.launch.unknownProblem'),
            )
            .filter((text, index, all) => all.indexOf(text) === index)
            .join(' '),
        );
        router.refresh();
        return;
      }
      setNotice(actionMessage(result.error));
    });
  }

  const pickHead = (department: LaunchDepartment) =>
    props.structureHref ? (
      <a
        href={props.structureHref}
        className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'shrink-0' })}
        data-testid="cycle-launch-pick-head"
      >
        {t('setup.launch.pickHead', { name: department.name })}
      </a>
    ) : null;

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      canClose={() => !pending}
      title={t('setup.launch.confirmTitle', { name: props.name })}
      description={
        props.departments.length > 0
          ? t('setup.launch.confirmBody', {
              count: props.departments.length,
              deadline: props.deadline,
            })
          : undefined
      }
      closeLabel={t('setup.close')}
      size="md"
      data-testid="cycle-launch-dialog"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={props.onClose}
            disabled={pending}
            data-testid="cycle-launch-cancel"
          >
            {t('setup.cancel')}
          </Button>
          <Button
            onClick={onLaunch}
            disabled={pending || blocked}
            busy={pending}
            aria-describedby={blocked ? `${listId}-problems` : undefined}
            data-testid="cycle-launch-confirm"
          >
            <Icon name="flag" />
            {pending ? t('setup.working') : t('setup.launch.confirm')}
          </Button>
        </>
      }
    >
      {notice ? (
        <Alert tone="danger" data-testid="cycle-launch-error">
          {notice}
        </Alert>
      ) : null}
      {blocked ? (
        <div
          id={`${listId}-problems`}
          className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning-subtle px-4 py-3.5"
          data-testid="cycle-problems"
        >
          <p className="m-0 font-semibold">{t('setup.launch.notReady')}</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {props.problems.map((problem) => {
              const fix = PROBLEM_FIX[problem];
              return (
                <li
                  key={problem}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
                  data-testid={`cycle-problem-${problem}`}
                >
                  <span className="min-w-0 flex-1 text-sm">
                    {t(`setup.launch.problems.${problem}`)}
                  </span>
                  {fix ? (
                    <a
                      href={fix === 'edit' ? props.editHref : props.settingsHref}
                      className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                      data-testid={`cycle-problem-fix-${problem}`}
                    >
                      {t(`setup.launch.fix.${fix}`)}
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {props.departments.length > 0 ? (
        // The list scrolls when it is long: it takes the keyboard focus so the keys can scroll it too
        // (WCAG 2.1.1; axe scrollable-region-focusable).
        <div
          role="group"
          aria-label={t('setup.launch.listLabel')}
          className="max-h-56 overflow-y-auto rounded-xl border border-border focus-visible:outline-2 focus-visible:outline-offset-2"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region takes focus
          tabIndex={0}
          data-testid="cycle-launch-departments"
        >
          <ul className="m-0 flex list-none flex-col p-0">
            {props.departments.map((department) => (
              <li
                key={department.id}
                className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-3.5 py-2 text-sm last:border-b-0"
                data-testid="cycle-launch-department"
              >
                <span className="font-medium">{department.name}</span>
                {department.head === null ? (
                  <Badge tone="warning">{t('dialog.noHeadYet')}</Badge>
                ) : (
                  <span className="text-text-muted">{department.head}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {withoutHead.length > 0 && withoutHead.length <= NAMED_WITHOUT_HEAD
        ? withoutHead.map((department) => (
            <div
              key={department.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/40 bg-warning-subtle px-4 py-3"
              data-testid="cycle-launch-no-head"
            >
              <p className="m-0 min-w-0 flex-1 text-sm">
                {t('setup.launch.noHead', { name: department.name })}
              </p>
              {pickHead(department)}
            </div>
          ))
        : null}
      {withoutHead.length > NAMED_WITHOUT_HEAD ? (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/40 bg-warning-subtle px-4 py-3"
          data-testid="cycle-launch-no-head"
        >
          <p className="m-0 min-w-0 flex-1 text-sm">
            {t('setup.scope.noHeadWarning', { count: withoutHead.length })}
          </p>
          {props.structureHref ? (
            <a
              href={props.structureHref}
              className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'shrink-0' })}
              data-testid="cycle-launch-pick-head"
            >
              {t('setup.budget.pickHead')}
            </a>
          ) : null}
        </div>
      ) : null}
      {withoutHead.length > 0 &&
      withoutHead.length <= NAMED_WITHOUT_HEAD &&
      props.structureHref === null ? (
        <p className="m-0 text-[13px] text-text-muted" data-testid="cycle-launch-ask-hr">
          {t('setup.launch.askHr')}
        </p>
      ) : null}
    </Dialog>
  );
}

/** «Launch cycle» on the cycle's Settings page: the same question as the row menu's. */
export function LaunchCycleButton(props: Omit<LaunchCycleDialogProps, 'open' | 'onClose'>) {
  const { t } = usePlanningTexts(props.texts, props.errors, props.locale);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          // The open section has unsaved entries: launching would leave them behind (a launched cycle's
          // settings no longer change).
          if (document.body.dataset.unsaved === 'true') {
            toast.warning(t('setup.unsavedFirst'));
            return;
          }
          setOpen(true);
        }}
        data-testid="cycle-launch"
      >
        <Icon name="flag" />
        {t('setup.launch.action')}
      </Button>
      <LaunchCycleDialog
        {...props}
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

export interface DeleteCycleDialogProps extends Common {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The cycle's name in the page's language. */
  readonly name: string;
  /** Deleted: the list says so. */
  readonly onDeleted: () => void;
}

/** «Delete draft» of the row menu: only a draft is deleted (the database refuses a launched cycle). */
export function DeleteCycleDialog(props: DeleteCycleDialogProps) {
  const { t, actionMessage } = usePlanningTexts(props.texts, props.errors, props.locale);
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  function onDelete() {
    setNotice(null);
    startTransition(async () => {
      const result = await deletePlanCycleAction(props.cycle);
      if (result.ok) {
        props.onDeleted();
        return;
      }
      if (sessionRefused(result.error)) return;
      setNotice(actionMessage(result.error));
    });
  }

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      canClose={() => !pending}
      title={t('setup.delete.confirmTitle', { name: props.name })}
      description={t('setup.delete.confirmBody')}
      closeLabel={t('setup.close')}
      tone="danger"
      size="sm"
      data-testid="cycle-delete-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose} disabled={pending}>
            {t('setup.delete.keep')}
          </Button>
          <Button
            variant="danger"
            onClick={onDelete}
            disabled={pending}
            busy={pending}
            data-testid="cycle-delete-confirm"
          >
            {pending ? t('setup.working') : t('setup.delete.confirm')}
          </Button>
        </>
      }
    >
      {notice ? <Alert tone="danger">{notice}</Alert> : null}
    </Dialog>
  );
}
