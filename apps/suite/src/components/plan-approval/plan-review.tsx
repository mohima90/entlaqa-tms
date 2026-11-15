'use client';
import type { PlanApprovalView, PlanView } from '@jadarat/tms';
import { decidePlanAction } from '@jadarat/tms/actions/approval';
import { SEND_BACK_COMMENT_MAX } from '@jadarat/tms/approval-rules';
import { Alert, Button, Dialog, FieldError, FieldMarker, Icon, cn, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, useMemo, useState, useTransition } from 'react';
import { decidersLabel, personLabel } from '../../lib/plan-approval-view';
import type { ErrorTexts } from '../auth/error-text';
import { LoadLatestVersion } from '../latest-version';
import { planModel } from '../training-plan/plan-shared';
import { usePlanTexts } from '../training-plan/use-plan-texts';

export interface PlanReviewProps {
  readonly locale: 'ar' | 'en';
  readonly view: PlanView;
  readonly approval: PlanApprovalView;
  readonly planName: string;
  readonly viewerPersonId: string | null;
  readonly moments: Readonly<Record<string, string>>;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

/**
 * «Send back» and «Approve» (or «Confirm» at the Finance step) on the plan review (WP-LD-03; approved designs 5b,
 * 5c): each asks first in a small popup — sending back needs one comment for the whole plan (Q5 = A). Shown only
 * to whoever decides the step now (the query says so; the database decides again).
 */
export function ReviewActions(props: PlanReviewProps) {
  const { approval, locale } = props;
  const texts = usePlanTexts(props.texts, props.errors, locale);
  const { t } = texts;
  const [dialog, setDialog] = useState<'approve' | 'sendBack' | null>(null);
  const step = approval.can.decide;
  if (step === null) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="review-actions">
      <Button
        variant="secondary"
        onClick={() => {
          setDialog('sendBack');
        }}
        data-testid="review-send-back"
      >
        <Icon name="undo" className="size-4" />
        {t('approval.review.sendBack')}
      </Button>
      <Button
        onClick={() => {
          setDialog('approve');
        }}
        data-testid="review-approve"
      >
        <Icon name="check" className="size-4" />
        {step === 'finance' ? t('approval.review.confirm') : t('approval.review.approve')}
      </Button>
      {dialog === 'approve' ? (
        <ApproveDialog
          {...props}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === 'sendBack' ? (
        <SendBackDialog
          {...props}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

function useDecision(props: PlanReviewProps, onClose: () => void) {
  const texts = usePlanTexts(props.texts, props.errors, props.locale);
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const plan = props.approval.plan;
  const step = props.approval.can.decide;
  const decide = (
    decision: 'approve' | 'send_back',
    comment: string | null,
    done: (status: string, approvalStep: string | null) => string,
    onFieldError?: (message: string) => void,
  ) => {
    if (step === null) return;
    setNotice(null);
    startTransition(async () => {
      const result = await decidePlanAction({
        planId: plan.id,
        version: plan.version,
        step,
        decision,
        comment,
      });
      if (result.ok) {
        onClose();
        toast.success(done(result.value.status, result.value.approvalStep));
        router.refresh();
        return;
      }
      if (texts.sessionRefused(result.error)) return;
      const field = texts.fieldErrors(result.error).comment;
      if (field && onFieldError) onFieldError(field);
      setNotice(texts.formMessage(result.error));
    });
  };
  return { texts, notice, pending, decide };
}

function ApproveDialog(props: PlanReviewProps & { readonly onClose: () => void }) {
  const { approval, onClose } = props;
  const { texts, notice, pending, decide } = useDecision(props, onClose);
  const { t } = texts;
  const plan = approval.plan;
  const finance = approval.can.decide === 'finance';
  const financeNext = !finance && plan.financeStep;
  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      canClose={() => !pending}
      size="sm"
      title={
        finance
          ? t('approval.review.confirmTitle', { plan: props.planName })
          : t('approval.review.approveTitle', { plan: props.planName })
      }
      description={
        financeNext
          ? t('approval.review.approveFinanceNext')
          : t('approval.review.approveLast', { version: plan.planVersion })
      }
      closeLabel={t('approval.close')}
      data-testid="review-approve-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('approval.cancel')}
          </Button>
          <Button
            busy={pending}
            disabled={pending}
            onClick={() => {
              decide('approve', null, (status) =>
                status === 'approved'
                  ? t('approval.review.approvedLast', { version: plan.planVersion })
                  : t('approval.review.approved'),
              );
            }}
            data-testid="review-approve-confirm"
          >
            <Icon name="check" className="size-4" />
            {finance ? t('approval.review.confirm') : t('approval.review.approve')}
          </Button>
        </>
      }
    >
      {notice ? (
        <Alert tone="danger" data-testid="review-notice">
          {notice}
          <LoadLatestVersion message={notice} />
        </Alert>
      ) : null}
    </Dialog>
  );
}

/** «Send the plan back to Huda Saleh?» (design 5c; 448 px): one required comment. */
function SendBackDialog(props: PlanReviewProps & { readonly onClose: () => void }) {
  const { approval, locale, onClose } = props;
  const { texts, notice, pending, decide } = useDecision(props, onClose);
  const { t } = texts;
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const name = personLabel(locale, approval.plan.submittedBy, t('approval.history.someone'));

  function send() {
    if (comment.trim() === '') {
      setError(t('approval.review.commentRequired'));
      return;
    }
    decide('send_back', comment.trim(), () => t('approval.review.sentBack', { name }), setError);
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      canClose={() => !pending}
      size="sm"
      title={t('approval.review.sendBackTitle', { name })}
      description={t('approval.review.sendBackBody', { name })}
      closeLabel={t('approval.close')}
      data-testid="review-send-back-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('approval.cancel')}
          </Button>
          <Button
            busy={pending}
            disabled={pending}
            onClick={send}
            data-testid="review-send-back-confirm"
          >
            <Icon name="undo" className="size-4" />
            {t('approval.review.sendBack')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {notice ? (
          <Alert tone="danger" data-testid="review-notice">
            {notice}
            <LoadLatestVersion message={notice} />
          </Alert>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="review-comment" className="text-sm font-semibold">
            {t('approval.review.comment')}
            <FieldMarker required marker={t('required')} />
          </label>
          <textarea
            id="review-comment"
            rows={4}
            aria-required="true"
            maxLength={SEND_BACK_COMMENT_MAX}
            value={comment}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'review-comment-error' : 'review-comment-hint'}
            onChange={(event) => {
              setComment(event.target.value);
              setError(undefined);
            }}
            disabled={pending}
            className={cn(
              'w-full rounded-md border-[1.5px] border-border-strong bg-surface px-3.5 py-2 text-[15px] text-text focus:border-primary',
              error && 'border-danger',
            )}
            data-testid="review-comment"
          />
          <p id="review-comment-hint" className="m-0 text-[13.5px] text-text-muted">
            {t('approval.review.commentHint', { name })}
          </p>
          {error ? <FieldError id="review-comment-error">{error}</FieldError> : null}
        </div>
      </div>
    </Dialog>
  );
}

/**
 * The review's side column (design 5b): the approval steps in order (submitted ✓ → HR Manager → Finance, with who
 * may decide and who did), the lines left out with their reasons, and the history.
 */
export function ApprovalSide(props: PlanReviewProps) {
  const { approval, view, locale } = props;
  const texts = usePlanTexts(props.texts, props.errors, locale);
  const { t } = texts;
  const model = useMemo(() => planModel(locale, view, texts), [locale, view, texts]);
  const moment = (iso: string | null) => (iso ? (props.moments[iso] ?? iso) : '');
  const someone = t('approval.history.someone');
  const or = t('approval.or');
  const names = (step: 'hr' | 'finance') =>
    decidersLabel(locale, approval.steps[step].deciders, or, props.viewerPersonId, (name) =>
      t('approval.steps.you', { name }),
    );
  const plan = approval.plan;
  const submitted = plan.submittedAt !== null && plan.status !== 'draft';
  const leftOut = view.lines.filter((l) => l.status === 'left_out');

  const stepLine = (step: 'hr' | 'finance'): string => {
    const s = approval.steps[step];
    switch (s.state) {
      case 'done':
        return t('approval.steps.done', {
          name: personLabel(locale, s.decidedBy, someone),
          date: moment(s.decidedAt),
        });
      case 'waiting':
        return names(step)
          ? t('approval.steps.waiting', { names: names(step) })
          : t('approval.steps.waitingNobody');
      case 'later':
        return t('approval.steps.later', { names: names(step) || '—' });
      case 'off':
        return t('approval.steps.off');
      case 'not_started':
        return t('approval.steps.notStarted');
    }
  };

  const marker = (
    state: 'done' | 'waiting' | 'later' | 'off' | 'not_started',
    n: number,
  ): ReactNode =>
    state === 'done' ? (
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-full bg-success-subtle text-success"
      >
        <Icon name="check" className="size-4" />
      </span>
    ) : (
      <span
        aria-hidden="true"
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold',
          state === 'waiting' ? 'bg-primary text-on-primary' : 'bg-surface-hover text-text-muted',
        )}
      >
        {n}
      </span>
    );

  const historyLine = (e: PlanApprovalView['events'][number]) =>
    t(`approval.history.${e.kind}`, {
      name: personLabel(locale, e.actor, someone),
      version: e.planVersion,
    });

  return (
    <aside
      className="grid items-start gap-5 lg:grid-cols-3 min-[1680px]:grid-cols-1"
      data-testid="approval-side"
    >
      <section
        aria-labelledby="approval-steps-title"
        className="rounded-xl border border-border bg-surface p-5 shadow-1"
        data-testid="approval-steps"
      >
        <h2
          id="approval-steps-title"
          className="m-0 mb-4 flex items-center gap-2 text-lg font-bold"
        >
          <Icon name="success" className="size-5" />
          {t('approval.steps.title')}
        </h2>
        <ol className="m-0 flex list-none flex-col gap-4 p-0">
          <li className="flex items-start gap-3">
            {marker(submitted ? 'done' : 'not_started', 1)}
            <span className="flex flex-col">
              <b>{submitted ? t('approval.steps.submitted') : t('approval.steps.notSubmitted')}</b>
              {submitted ? (
                <span className="text-sm text-text-muted">
                  {t('approval.steps.done', {
                    name: personLabel(locale, plan.submittedBy, someone),
                    date: moment(plan.submittedAt),
                  })}
                </span>
              ) : null}
            </span>
          </li>
          {(['hr', 'finance'] as const).map((step, index) => (
            <li key={step} className="flex items-start gap-3" data-testid={`approval-step-${step}`}>
              {marker(approval.steps[step].state, index + 2)}
              <span className="flex flex-col">
                <b>{t(`approval.steps.${step}`)}</b>
                <span className="text-sm text-text-muted">{stepLine(step)}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="approval-left-out-title"
        className="rounded-xl border border-border bg-surface p-5 shadow-1"
        data-testid="approval-left-out"
      >
        <h2
          id="approval-left-out-title"
          className="m-0 mb-3 flex items-center gap-2 text-lg font-bold"
        >
          <Icon name="ban" className="size-5" />
          {t('approval.leftOut.title')}
          <span className="ms-auto rounded-full bg-surface-hover px-2 text-sm tabular-nums">
            {model.number(leftOut.length)}
          </span>
        </h2>
        {leftOut.length === 0 ? (
          <p className="m-0 text-text-muted">{t('approval.leftOut.empty')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {leftOut.map((line) => (
              <li key={line.id} className="flex flex-col gap-1 py-3 first:pt-0">
                <span>
                  <b>{line.title}</b>
                  <span className="text-text-muted">
                    {' · '}
                    {t('approval.leftOut.who', {
                      departments: line.departments
                        .map((d) => model.departmentName(d.departmentId))
                        .join(t('listSeparator')),
                      count: line.people,
                    })}
                  </span>
                </span>
                {line.leftOutReason ? (
                  <span className="text-sm text-text-muted">«{line.leftOutReason}»</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="approval-history-title"
        className="rounded-xl border border-border bg-surface p-5 shadow-1"
        data-testid="approval-history"
      >
        <h2
          id="approval-history-title"
          className="m-0 mb-3 flex items-center gap-2 text-lg font-bold"
        >
          <Icon name="clock" className="size-5" />
          {t('approval.history.title')}
        </h2>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-sm">
          {approval.events.map((e) => (
            <li key={`${e.kind}:${e.at}`} className="flex flex-col">
              <span>
                <span className="text-text-muted">{moment(e.at)} — </span>
                {historyLine(e)}
              </span>
              {e.comment ? (
                <span className="whitespace-pre-line text-text-muted">«{e.comment}»</span>
              ) : null}
            </li>
          ))}
          <li className="text-text-muted">{t('approval.history.opened')}</li>
        </ul>
      </section>
    </aside>
  );
}
