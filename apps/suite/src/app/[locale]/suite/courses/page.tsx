import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import {
  type CourseCategoryRow,
  type CourseCounts,
  type CourseRow,
  OFFERED_DELIVERY_TYPES,
  countCourses,
  courseCategoryName,
  courseMatches,
  courseTitle,
} from '@jadarat/tms/courses';
import { Alert, PageHeader } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getMessages, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { type CourseListItem, CoursesScreen } from '../../../../components/courses/courses-screen';
import { SuiteShell } from '../../../../components/suite-shell';
import { coursesPageQuery } from '../../../../lib/courses-queries';
import {
  type CoursesParams,
  PREVIEW_CATEGORIES,
  PREVIEW_COURSES,
  coursesParams,
  coursesPath,
  previewFilter,
} from '../../../../lib/courses-view';
import { flattenTexts } from '../../../../lib/flatten-texts';
import { profileErrorTexts } from '../../../../lib/profile-texts';
import { getSuiteContext } from '../../../../lib/suite-context';

/** What the page shows: the query's answer, or the example library without a database. */
interface CoursesPageData {
  readonly courses: readonly CourseRow[];
  readonly truncated: boolean;
  readonly categories: readonly CourseCategoryRow[];
  readonly counts: CourseCounts;
  readonly currency: string;
  readonly canManage: boolean;
  readonly canArchive: boolean;
  readonly canSeeCosts: boolean;
  /** The language whose title is required: the organization's default language. */
  readonly nameLanguage: 'ar' | 'en';
  readonly preview: boolean;
}

/**
 * Courses (T-M3-03; FR-CAT-01, FR-CAT-10; redesign package 4): view cards as the status filter, instant
 * search and filter pills, the list (cards on phones), a course's read panel. The Kawadir pattern
 * (WP-UX-01 c, T-M3-21): «Add course» is one popup, the rest of a course is on its Settings page
 * (`[courseId]/settings`), archive / restore from the row menu after a small confirmation, with Undo.
 * Holders of tms.course.read see the library (L&D Manager, Training Coordinator, HR Manager, Department
 * Head); tms.course.manage adds and edits, tms.course.archive archives and restores; the estimated costs
 * show for tms.course_cost.read, in the organization's currency (General settings). The Organization Admin
 * has no training access (BR-IAM-4).
 */
export default async function CoursesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'courses' });
  const requested = coursesParams(await searchParams);

  let current: CoursesParams = requested;
  let invalidFilters = false;
  let data: CoursesPageData | null = null;
  let failure: string | null = null;
  if (!context.live) {
    data = {
      courses: PREVIEW_COURSES.filter((course) => courseMatches(course, previewFilter(requested))),
      truncated: false,
      categories: PREVIEW_CATEGORIES,
      counts: countCourses(PREVIEW_COURSES),
      currency: 'SAR',
      canManage: true,
      canArchive: true,
      canSeeCosts: true,
      // The example library is titled in both languages: the page's language is asked first.
      nameLanguage: locale,
      preview: true,
    };
  } else {
    // Untrusted query-string values: the query's zod schema validates them (bad values → all courses).
    let result = await coursesPageQuery(requested);
    if (!result.ok && result.error.code === 'VALIDATION_FAILED') {
      invalidFilters = true;
      current = {};
      result = await coursesPageQuery({});
    }
    if (result.ok) {
      data = { ...result.value, preview: false };
    } else {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      const errors = await getTranslations({ locale, namespace: 'errors' });
      failure =
        error.code === 'FORBIDDEN'
          ? errors('forbidden')
          : errors('internalError', { correlationId: error.correlationId ?? '' });
    }
  }

  const messages = await getMessages({ locale });
  const common = await getTranslations({ locale, namespace: 'common' });
  const format = await getFormatter({ locale });
  const texts = {
    ...flattenTexts(messages.courses),
    required: common('required'),
    optional: common('optional'),
    undo: common('undo'),
  };
  const errorTexts = data?.canManage || data?.canArchive ? await profileErrorTexts(locale) : {};

  let body;
  if (!data) {
    body = (
      <>
        <PageHeader title={t('title')} description={t('description')} />
        <Alert tone="warning" data-testid="courses-failure">
          {failure}
        </Alert>
      </>
    );
  } else {
    const page = data;
    const integer = (n: number) => format.number(n, 'integer');
    const amount = (value: number, currency: string) =>
      format.number(value, { style: 'currency', currency, maximumFractionDigits: 2 });
    // A category and a course may be named in one language only: the name that exists is shown.
    const categoryName = (category: CourseCategoryRow) => courseCategoryName(category, locale);
    const categories = new Map(page.categories.map((c) => [c.id, c]));
    const items: CourseListItem[] = page.courses.map((course) => {
      const category = course.categoryId ? categories.get(course.categoryId) : undefined;
      const currency = course.costCurrency ?? page.currency;
      const description = locale === 'ar' ? course.descriptionAr : course.descriptionEn;
      const title = courseTitle(course, locale);
      const otherTitle = courseTitle(course, locale === 'ar' ? 'en' : 'ar');
      return {
        course,
        title,
        // The other language's title under it — when the course has one.
        otherTitle: otherTitle === title ? null : otherTitle,
        description: description === '' ? null : description,
        category: category ? categoryName(category) : null,
        deliveryType: t(`deliveryTypes.${course.deliveryType}`),
        duration: t('hours', { count: course.durationHours }),
        durationDays:
          course.durationDays !== null ? t('days', { count: course.durationDays }) : null,
        participants: t('participantsRange', {
          min: integer(course.minParticipants),
          max: integer(course.maxParticipants),
        }),
        costSession:
          course.estCostPerSession !== null
            ? t('perSession', { amount: amount(course.estCostPerSession, currency) })
            : null,
        costParticipant:
          course.estCostPerParticipant !== null
            ? t('perParticipant', { amount: amount(course.estCostPerParticipant, currency) })
            : null,
      };
    });
    body = (
      <CoursesScreen
        locale={locale}
        items={items}
        params={current}
        counts={{
          total: integer(page.counts.total),
          active: integer(page.counts.active),
          archived: integer(page.counts.archived),
        }}
        categoryOptions={[
          ...page.categories.map((c) => ({ value: c.id, label: categoryName(c) })),
          { value: 'none', label: t('noCategory') },
        ]}
        deliveryOptions={OFFERED_DELIVERY_TYPES.map((value) => ({
          value,
          label: t(`deliveryTypes.${value}`),
        }))}
        canManage={page.canManage}
        canArchive={page.canArchive}
        canSeeCosts={page.canSeeCosts}
        truncated={page.truncated}
        add={{
          nameLanguage: page.nameLanguage,
          deliveryTypes: OFFERED_DELIVERY_TYPES.map((value) => ({
            value,
            label: t(`deliveryTypes.${value}`),
          })),
        }}
        preview={page.preview}
        texts={texts}
        errors={errorTexts}
        notices={
          page.preview || invalidFilters ? (
            <>
              {page.preview ? (
                <Alert tone="info" data-testid="courses-not-configured">
                  {t('notConfigured')}
                </Alert>
              ) : null}
              {invalidFilters ? <Alert tone="warning">{t('invalidFilters')}</Alert> : null}
            </>
          ) : null
        }
      />
    );
  }

  return (
    <SuiteShell locale={locale} context={context} current="courses" path={coursesPath(current)}>
      {body}
    </SuiteShell>
  );
}
