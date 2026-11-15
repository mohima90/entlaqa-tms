import { toClientError } from '@jadarat/platform-core';
import type { AppLocale, DateDisplay } from '@jadarat/platform-i18n';
import type { DraftSessionDetailView, PlanLineDeliveryView } from '@jadarat/tms';
import { OFFERED_DELIVERY_TYPES } from '@jadarat/tms/courses';
import { Alert } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { courseSettingsHref } from '../../lib/courses-view';
import { coursesPageQuery } from '../../lib/courses-queries';
import { monthsBetween, formatMonth } from '../../lib/month-format';
import {
  deliveryErrorTexts,
  deliveryTexts,
  draftProposalQuery,
  draftSessionQuery,
} from '../../lib/plan-delivery-queries';
import {
  PREVIEW_LIBRARY,
  previewDraft,
  previewPlan,
  previewProposal,
} from '../../lib/plan-delivery-preview';
import { trainingPlanQuery } from '../../lib/training-plan-queries';
import type { DeliveryPopup } from '../../lib/plan-delivery-view';
import { localName } from '../../lib/planning-view';
import { CreateSessionsDialog } from './create-sessions-dialog';
import { DraftSessionDialog } from './draft-session-dialog';
import { LineCourseDialog } from './line-course-dialog';

/**
 * The popups of «Courses and sessions» and of the training calendar, rendered on the server from their address
 * (WP-LD-04): the server reads what each needs — the library for «A course for …», the proposal for «Create draft
 * sessions», the draft — and hands it to the popup. A popup the viewer may not open says why in place.
 */

/** Digits after the decimal point of a currency (SAR 2, KWD 3). */
export function currencyDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

function amountText(locale: AppLocale, value: string, currency: string): string {
  try {
    return new Intl.NumberFormat(`${locale}-u-nu-latn`, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: currencyDigits(currency),
    }).format(Number(value));
  } catch {
    return `${value} ${currency}`;
  }
}

async function refusal(locale: AppLocale, error: unknown): Promise<ReactNode> {
  const client = toClientError(error as never);
  const errors = await getTranslations({ locale, namespace: 'errors' });
  return (
    <Alert tone="warning" data-testid="delivery-popup-refused">
      {client.code === 'FORBIDDEN'
        ? errors('forbidden')
        : client.code === 'NOT_FOUND'
          ? errors('notFound')
          : errors('internalError', { correlationId: client.correlationId ?? '' })}
    </Alert>
  );
}

/** «Q1 · 47 people from Sales, Finance · 3 sessions of 8–20 · SAR 9,000 per session». */
async function lineFacts(
  locale: AppLocale,
  line: PlanLineDeliveryView,
  currency: string,
  departments: string | null,
): Promise<string> {
  const t = await getTranslations({ locale, namespace: 'planDelivery' });
  return [
    t(`quarter.q${String(line.quarter)}`),
    departments
      ? t('courseDialog.peopleFrom', { count: line.people, departments })
      : t('courseDialog.people', { count: line.people }),
    line.plannedSessions === null
      ? null
      : line.minPerSession !== null && line.maxPerSession !== null
        ? t('courseDialog.sessionsOf', {
            count: line.plannedSessions,
            min: line.minPerSession,
            max: line.maxPerSession,
          })
        : t('courseDialog.sessionsOfMax', {
            count: line.plannedSessions,
            max: line.maxPerSession ?? 0,
          }),
    line.costPerSession === null
      ? null
      : t('courseDialog.perSession', { amount: amountText(locale, line.costPerSession, currency) }),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** «A course for «…»» of a line of the approved plan. */
export async function CoursePopup({
  locale,
  line,
  mode,
  currency,
  departments,
  closeHref,
  nextHref,
  preview,
}: {
  readonly locale: AppLocale;
  readonly line: PlanLineDeliveryView;
  readonly mode: 'create' | 'link';
  readonly currency: string;
  /** The line's departments by name (the line box), or null. */
  readonly departments: string | null;
  readonly closeHref: string;
  readonly nextHref: string | null;
  readonly preview: boolean;
}) {
  if (!line.can.createCourse && !line.can.linkCourse) {
    const t = await getTranslations({ locale, namespace: 'planDelivery' });
    return (
      <Alert tone="info" data-testid="delivery-popup-refused">
        {line.status === 'left_out' ? t('courseDialog.leftOut') : t('courseDialog.notNow')}
      </Alert>
    );
  }
  const library = preview
    ? {
        ok: true as const,
        value: {
          courses: PREVIEW_LIBRARY.map((c) => ({ ...c, version: 1 })),
          truncated: false,
          categories: [],
          canSeeCosts: true,
          nameLanguage: 'en' as const,
        },
      }
    : await coursesPageQuery({ status: 'active' });
  if (!library.ok) return refusal(locale, library.error);
  const courses = await getTranslations({ locale, namespace: 'courses' });
  return (
    <LineCourseDialog
      locale={locale}
      line={{
        id: line.lineId,
        version: line.version,
        title: line.title,
        facts: await lineFacts(locale, line, currency, departments),
      }}
      draft={line.can.createCourse ? line.courseDraft : null}
      mode={mode}
      canCreate={line.can.createCourse && line.courseDraft !== null}
      canLink={line.can.linkCourse}
      nameLanguage={library.value.nameLanguage}
      deliveryTypes={OFFERED_DELIVERY_TYPES.map((value) => ({
        value,
        label: courses(`deliveryTypes.${value}`),
      }))}
      categories={library.value.categories.map((c) => ({
        id: c.id,
        name: localName(locale, { ar: c.nameAr, en: c.nameEn }),
      }))}
      courses={library.value.courses.map((c) => ({
        id: c.id,
        code: c.code,
        title: localName(locale, { ar: c.titleAr, en: c.titleEn }),
        deliveryType: c.deliveryType,
        durationHours: c.durationHours,
      }))}
      truncated={library.value.truncated}
      currentCourseId={line.course?.id ?? null}
      costsVisible={library.value.canSeeCosts}
      currency={currency}
      closeHref={closeHref}
      nextHref={nextHref}
      preview={preview}
      texts={deliveryTexts(locale)}
      errors={await deliveryErrorTexts(locale)}
    />
  );
}

/** «Create draft sessions» of a line. */
export async function SessionsPopup({
  locale,
  lineId,
  display,
  closeHref,
  preview,
}: {
  readonly locale: AppLocale;
  readonly lineId: string;
  readonly display: DateDisplay;
  readonly closeHref: string;
  readonly preview: boolean;
}) {
  const result = preview
    ? (() => {
        const view = previewProposal(lineId);
        return view
          ? { ok: true as const, value: view }
          : { ok: false as const, error: { code: 'NOT_FOUND' } };
      })()
    : await draftProposalQuery({ lineId });
  if (!result.ok) return refusal(locale, result.error);
  const view = result.value;
  const t = await getTranslations({ locale, namespace: 'planDelivery' });
  const currency = view.cycle.currency;
  const quarter = t(`quarter.q${String(view.line.quarter)}`);
  const facts = [
    t('sessionsDialog.leadPeople', { count: view.line.people }),
    view.line.plannedSessions === null
      ? null
      : view.line.minPerSession !== null && view.line.maxPerSession !== null
        ? t('courseDialog.sessionsOf', {
            count: view.line.plannedSessions,
            min: view.line.minPerSession,
            max: view.line.maxPerSession,
          })
        : t('courseDialog.sessionsOfMax', {
            count: view.line.plannedSessions,
            max: view.line.maxPerSession ?? 0,
          }),
    quarter,
    view.line.costPerSession === null
      ? null
      : t('sessionsDialog.each', {
          amount: amountText(locale, view.line.costPerSession, currency),
        }),
  ].filter(Boolean);
  return (
    <CreateSessionsDialog
      locale={locale}
      view={view}
      months={monthsBetween(view.cycle.periodStart, view.cycle.periodEnd).map((value) => ({
        value,
        label: formatMonth(value, locale, display, 'long'),
      }))}
      lead={t('sessionsDialog.leadPlan', { facts: facts.join(t('listSeparator')) })}
      quarter={quarter}
      fractionDigits={currencyDigits(currency)}
      closeHref={closeHref}
      preview={preview}
      texts={deliveryTexts(locale)}
      errors={await deliveryErrorTexts(locale)}
    />
  );
}

/** A draft opened from the calendar. */
export async function DraftPopup({
  locale,
  sessionId,
  display,
  closeHref,
  preview,
}: {
  readonly locale: AppLocale;
  readonly sessionId: string;
  readonly display: DateDisplay;
  readonly closeHref: string;
  readonly preview: boolean;
}) {
  const result = preview
    ? (() => {
        const view = previewDraft(sessionId);
        return view
          ? { ok: true as const, value: view }
          : { ok: false as const, error: { code: 'NOT_FOUND' } };
      })()
    : await draftSessionQuery({ sessionId });
  if (!result.ok) return refusal(locale, result.error);
  const view: DraftSessionDetailView = result.value;
  const t = await getTranslations({ locale, namespace: 'planDelivery' });
  const courses = await getTranslations({ locale, namespace: 'courses' });
  const quarter = t(`quarter.q${String(view.line.quarter)}`);
  // The departments of the line's people by name (the plan's: the people to add and the seats without names).
  const plan = preview
    ? { ok: true as const, value: previewPlan() }
    : await trainingPlanQuery({ cycleId: view.plan.cycleId });
  const names: Record<string, string> = {};
  if (plan.ok) for (const d of plan.value.departments) names[d.id] = localName(locale, d.name);
  for (const p of view.participants) names[p.departmentId] ??= localName(locale, p.departmentName);
  return (
    <DraftSessionDialog
      // A new version (a person moved to another draft, review L6) opens the popup anew with it.
      key={`${view.session.id}:${String(view.session.version)}`}
      locale={locale}
      view={view}
      months={monthsBetween(view.plan.periodStart, view.plan.periodEnd).map((value) => ({
        value,
        label: formatMonth(value, locale, display, 'long'),
      }))}
      course={
        view.course
          ? {
              title: localName(locale, { ar: view.course.titleAr, en: view.course.titleEn }),
              facts: [
                view.course.code,
                courses(`deliveryTypes.${view.course.deliveryType}`),
                t('draftDialog.hours', { count: view.course.durationHours }),
              ].join(' · '),
              href: courseSettingsHref(locale, view.course.id),
            }
          : null
      }
      plan={{
        name: localName(locale, view.plan.cycleName),
        facts: `${view.line.title} · ${quarter}`,
        href: `/${locale}/suite/planning/cycles/${view.plan.cycleId}?tab=plan`,
      }}
      cost={
        view.session.estimatedCost === null || view.session.currency === null
          ? null
          : amountText(locale, view.session.estimatedCost, view.session.currency)
      }
      quarter={quarter}
      departments={names}
      closeHref={closeHref}
      preview={preview}
      texts={deliveryTexts(locale)}
      errors={await deliveryErrorTexts(locale)}
    />
  );
}

/** The popup a line's address opens (`?open=…&line=…`), given the line's delivery view (course popups). */
export async function LinePopup({
  locale,
  popup,
  line,
  currency,
  departments,
  display,
  closeHref,
  nextHref,
  preview,
}: {
  readonly locale: AppLocale;
  readonly popup: Exclude<DeliveryPopup, null>;
  readonly line: PlanLineDeliveryView | null;
  readonly currency: string;
  readonly departments: string | null;
  readonly display: DateDisplay;
  readonly closeHref: string;
  readonly nextHref: string | null;
  readonly preview: boolean;
}) {
  if (popup.kind === 'sessions') {
    return SessionsPopup({ locale, lineId: popup.lineId, display, closeHref, preview });
  }
  if (!line) return refusal(locale, { code: 'NOT_FOUND' });
  return CoursePopup({
    locale,
    line,
    mode: popup.mode,
    currency,
    departments,
    closeHref,
    nextHref,
    preview,
  });
}
