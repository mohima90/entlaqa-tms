'use client';
import type { PlanApprovalView, PlanView } from '@jadarat/tms';
import { revisePlanAction, submitPlanAction } from '@jadarat/tms/actions/approval';
import {
  Alert,
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
  cn,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { decidersLabel, personLabel, planVersionHref } from '../../lib/plan-approval-view';
import type { ErrorTexts } from '../auth/error-text';
import { LoadLatestVersion } from '../latest-version';
import { planModel } from '../training-plan/plan-shared';
import { usePlanTexts } from '../training-plan/use-plan-texts';

export interface PlanApprovalBarProps {
  readonly locale: 'ar' | 'en';
  readonly view: PlanView;
  readonly approval: PlanApprovalView;
  /** The cycle's name as shown («Training plan 2027»). */
  readonly planName: string;
  /** Every moment of the approval as shown (ISO → text), formatted on the server. */
  readonly moments: Readonly<Record<string, string>>;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

/**
 * Where the plan's approval stands, on the cycle's Plan tab (WP-LD-03, T-M3-07; FR-PLN-08; approved designs 4 and
 * 6a): «Submit for approval» and its popup while a draft; the send-back comment once sent back; who it waits for
 * while frozen; once approved, the lock, «Versions» and «Revise plan». The database decides every step; this only
 * asks it.
 */
export function PlanApprovalBar(props: PlanApprovalBarProps) {
  const { approval, locale } = props;
  const texts = usePlanTexts(props.texts, props.errors, locale);
  const { t } = texts;
  const router = useRouter();
  const [dialog, setDialog] = useState<'submit' | 'revise' | null>(null);
  const plan = approval.plan;
  const moment = (iso: string | null) => (iso ? (props.moments[iso] ?? iso) : '');
  const someone = t('approval.history.someone');

  const versions =
    approval.versions.length > 0 ? (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex min-h-10 items-center gap-2 rounded-full border-[1.5px] border-border-strong px-4 text-sm font-semibold pointer-coarse:min-h-11"
          data-testid="plan-versions"
        >
          <Icon name="clock" className="size-4" />
          {t('approval.versions')}
          <Icon name="chevron-down" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {approval.versions.map((v) => (
            <DropdownMenuItem
              key={v.planVersion}
              onSelect={() => {
                router.push(planVersionHref(locale, plan.cycleId, v.planVersion));
              }}
              data-testid="plan-version-item"
            >
              <Icon name="lock" />
              {t('approval.versionItem', { version: v.planVersion, date: moment(v.approvedAt) })}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  let banner = null;
  if (plan.status === 'sent_back') {
    banner = (
      <Alert tone="warning" data-testid="plan-sent-back">
        <p className="m-0 font-semibold">
          {t('approval.sentBackBy', {
            name: personLabel(locale, plan.decidedBy, someone),
            date: moment(plan.decidedAt),
          })}
        </p>
        {plan.sendBackComment ? (
          <blockquote
            className="m-0 mt-1 whitespace-pre-line border-s-2 border-warning ps-3"
            data-testid="plan-sent-back-comment"
          >
            {plan.sendBackComment}
          </blockquote>
        ) : null}
        <p className="m-0 mt-1">{t('approval.sentBackHint')}</p>
      </Alert>
    );
  } else if (plan.status === 'in_approval') {
    banner = (
      <Alert tone="info" data-testid="plan-waiting">
        {plan.approvalStep === 'finance'
          ? t('approval.waitingFinance', { date: moment(approval.steps.hr.decidedAt) })
          : t('approval.waitingHr', { date: moment(plan.submittedAt) })}
      </Alert>
    );
  } else if (plan.status === 'approved') {
    banner = (
      <Alert tone="success" data-testid="plan-approved">
        <span className="inline-flex items-start gap-2">
          <Icon name="lock" className="mt-0.5 size-4 shrink-0" />
          <span>
            {t('approval.approvedBanner', {
              name: personLabel(locale, plan.approvedBy, someone),
              date: moment(plan.approvedAt),
              version: plan.planVersion,
              next: plan.planVersion + 1,
            })}
          </span>
        </span>
      </Alert>
    );
  } else if (plan.planVersion > 1) {
    banner = (
      <Alert tone="info" data-testid="plan-revision">
        {t('approval.revisionBanner', {
          version: plan.planVersion,
          previous: plan.planVersion - 1,
        })}
      </Alert>
    );
  }

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {versions}
      {approval.can.revise ? (
        <Button
          variant="secondary"
          onClick={() => {
            setDialog('revise');
          }}
          data-testid="plan-revise"
        >
          <Icon name="pencil" className="size-4" />
          {t('approval.revise')}
        </Button>
      ) : null}
      {approval.can.submit ? (
        <Button
          onClick={() => {
            setDialog('submit');
          }}
          data-testid="plan-submit"
        >
          <Icon name="send" className="size-4" />
          {t('approval.submit')}
        </Button>
      ) : null}
    </div>
  );
  const hasActions = approval.versions.length > 0 || approval.can.revise || approval.can.submit;

  return (
    <div className="flex flex-col gap-3" data-testid="plan-approval">
      {banner}
      {hasActions ? <div className="flex flex-wrap justify-end gap-2">{actions}</div> : null}
      {dialog === 'submit' ? (
        <SubmitPlanDialog
          {...props}
          texts={props.texts}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === 'revise' ? (
        <ReviseDialog
          {...props}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * «Submit Training plan 2027 for approval?» (design 4; 560 px): the totals, the departments over their budget with
 * their reasons, who decides — the HR Manager (named holders, the first decision counts) and Finance (named, or
 * «off») — and a warning when nobody holds a role that will be asked. Refused with the reason while not ready.
 */
function SubmitPlanDialog(props: PlanApprovalBarProps & { readonly onClose: () => void }) {
  const { view, approval, locale, onClose } = props;
  const texts = usePlanTexts(props.texts, props.errors, locale);
  const { t } = texts;
  const model = useMemo(() => planModel(locale, view, texts), [locale, view, texts]);
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const plan = approval.plan;
  const summary = view.summary;
  const over = view.budget.departments.filter((d) => d.state.kind === 'over');
  const departments = view.budget.departments.filter((d) => d.people > 0).length;
  const or = t('approval.or');
  const hrNames = decidersLabel(locale, approval.steps.hr.deciders, or);
  const financeOn = approval.financeSwitch;
  const financeNames = decidersLabel(locale, approval.steps.finance.deciders, or);
  const problem = approval.submitProblem;

  function submit() {
    setNotice(null);
    startTransition(async () => {
      const result = await submitPlanAction({ planId: plan.id, version: plan.version });
      if (result.ok) {
        onClose();
        toast.success(t('approval.submitted'));
        router.refresh();
        return;
      }
      if (texts.sessionRefused(result.error)) return;
      const params = result.error.params as { problem?: unknown } | undefined;
      const reason = typeof params?.problem === 'string' ? params.problem : null;
      setNotice(
        result.error.code === 'TRAINING_PLAN_NOT_SUBMITTABLE' && reason
          ? t(`approval.problem.${reason}`)
          : texts.formMessage(result.error),
      );
    });
  }

  const tile = (label: string, value: string, hint: string | null, testId: string) => (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border p-3" data-testid={testId}>
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="m-0 text-xl font-bold tabular-nums">{value}</dd>
      {hint ? <dd className="m-0 text-[13px] text-text-muted">{hint}</dd> : null}
    </div>
  );

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      canClose={() => !pending}
      size="md"
      title={t('approval.submitTitle', { plan: props.planName })}
      description={t('approval.submitIntro')}
      closeLabel={t('approval.close')}
      data-testid="plan-submit-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('approval.cancel')}
          </Button>
          <Button
            busy={pending}
            disabled={pending || problem !== null}
            onClick={submit}
            data-testid="plan-submit-confirm"
          >
            <Icon name="send" className="size-4" />
            {t('approval.submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {notice ? (
          <Alert tone="danger" data-testid="plan-submit-notice">
            {notice}
            <LoadLatestVersion message={notice} />
          </Alert>
        ) : null}
        {problem ? (
          <Alert tone="warning" data-testid="plan-submit-problem">
            {t(`approval.problem.${problem}`)}
          </Alert>
        ) : null}
        <dl
          className="m-0 grid grid-cols-2 gap-2.5 sm:grid-cols-4"
          aria-label={t('approval.tiles.label')}
        >
          {tile(
            t('approval.tiles.lines'),
            model.number(summary.lines),
            t('approval.tiles.linesHint', { count: summary.leftOut }),
            'plan-submit-lines',
          )}
          {tile(
            t('approval.tiles.people'),
            model.number(summary.people),
            t('approval.tiles.peopleHint', { count: departments }),
            'plan-submit-people',
          )}
          {tile(
            t('approval.tiles.sessions'),
            model.number(summary.sessions),
            null,
            'plan-submit-sessions',
          )}
          {tile(
            t('approval.tiles.cost'),
            model.amount(summary.cost),
            summary.envelope === null
              ? t('approval.tiles.noBudget')
              : t('approval.tiles.ofBudget', { amount: model.amount(summary.envelope) }),
            'plan-submit-cost',
          )}
        </dl>

        {over.length > 0 ? (
          <section aria-labelledby="plan-submit-over" data-testid="plan-submit-over">
            <h3
              id="plan-submit-over"
              className="m-0 mb-2 text-sm font-bold uppercase tracking-wide text-text-muted"
            >
              {t('approval.overTitle', { count: over.length })}
            </h3>
            <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-xl border border-border p-0">
              {over.map((d) => (
                <li
                  key={d.departmentId}
                  className="flex items-start justify-between gap-3 px-4 py-3"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <b>{model.departmentName(d.departmentId)}</b>
                    <span className="text-text-muted">
                      {d.reason ? `«${d.reason}»` : t('budget.reasonNeeded')}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 font-bold tabular-nums',
                      d.state.kind === 'over' && d.state.severity === 'red'
                        ? 'text-danger'
                        : 'text-warning',
                    )}
                  >
                    {d.state.kind === 'over'
                      ? t('approval.overBy', { amount: model.amount(d.state.overBy) })
                      : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="plan-submit-who" data-testid="plan-submit-who">
          <h3
            id="plan-submit-who"
            className="m-0 mb-2 text-sm font-bold uppercase tracking-wide text-text-muted"
          >
            {t('approval.whoDecides')}
          </h3>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            <li className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-full bg-primary font-bold text-on-primary"
              >
                1
              </span>
              <span className="flex flex-col gap-0.5">
                <b>{t('approval.hrStep')}</b>
                {hrNames ? (
                  <span className="text-text-muted">
                    {t('approval.hrStepNames', { names: hrNames })}
                  </span>
                ) : (
                  <span className="font-semibold text-warning" data-testid="plan-submit-no-hr">
                    {t('approval.hrStepNobody')}
                  </span>
                )}
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-full font-bold',
                  financeOn ? 'bg-primary text-on-primary' : 'bg-surface-hover text-text-muted',
                )}
              >
                2
              </span>
              <span className="flex flex-col gap-0.5">
                <b>{financeOn ? t('approval.financeStep') : t('approval.financeStepOff')}</b>
                {!financeOn ? (
                  <span className="text-text-muted">{t('approval.financeOffHint')}</span>
                ) : financeNames ? (
                  <span className="text-text-muted">
                    {t('approval.financeStepNames', { names: financeNames })}
                  </span>
                ) : (
                  <span className="font-semibold text-warning" data-testid="plan-submit-no-finance">
                    {t('approval.financeStepNobody')}
                  </span>
                )}
              </span>
            </li>
          </ol>
        </section>
      </div>
    </Dialog>
  );
}

/** «Revise plan» (design 6a): opens the next version as a draft; the approved one is kept. */
function ReviseDialog(props: PlanApprovalBarProps & { readonly onClose: () => void }) {
  const { approval, locale, onClose } = props;
  const texts = usePlanTexts(props.texts, props.errors, locale);
  const { t } = texts;
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const plan = approval.plan;

  function revise() {
    setNotice(null);
    startTransition(async () => {
      const result = await revisePlanAction({ planId: plan.id, version: plan.version });
      if (result.ok) {
        onClose();
        toast.success(t('approval.revised', { version: result.value.planVersion }));
        router.refresh();
        return;
      }
      if (texts.sessionRefused(result.error)) return;
      setNotice(texts.actionMessage(result.error));
    });
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      canClose={() => !pending}
      size="sm"
      tone="warning"
      title={t('approval.reviseTitle', { plan: props.planName })}
      description={t('approval.reviseBody', {
        version: plan.planVersion,
        next: plan.planVersion + 1,
      })}
      closeLabel={t('approval.close')}
      data-testid="plan-revise-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('approval.cancel')}
          </Button>
          <Button
            busy={pending}
            disabled={pending}
            onClick={revise}
            data-testid="plan-revise-confirm"
          >
            <Icon name="pencil" className="size-4" />
            {t('approval.revise')}
          </Button>
        </>
      }
    >
      {notice ? <Alert tone="danger">{notice}</Alert> : null}
    </Dialog>
  );
}
