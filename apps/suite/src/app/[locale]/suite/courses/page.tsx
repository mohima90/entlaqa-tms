import { toClientError } from '@jadarat/platform-core';
import type { AppLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import {
  type CourseCategoryRow,
  type CourseCounts,
  type CourseRow,
  DELIVERY_TYPES,
  countCourses,
  courseMatches,
} from '@jadarat/tms/courses';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Icon,
  PageHeader,
  StatCard,
  StatGrid,
  buttonClasses,
  tableClasses,
  toolbarFieldClasses,
} from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getMessages, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { CourseDialog } from '../../../../components/courses/course-dialog';
import { CourseStatusButton } from '../../../../components/courses/course-status-button';
import { SuiteShell } from '../../../../components/suite-shell';
import { coursesPageQuery } from '../../../../lib/courses-queries';
import {
  type CoursesParams,
  PREVIEW_CATEGORIES,
  PREVIEW_COURSES,
  coursesHref,
  coursesParams,
  coursesPath,
  isFiltered,
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
  readonly preview: boolean;
}

const selectClass = `${toolbarFieldClasses} select-chevron pe-10`;

/**
 * Courses (T-M3-03; FR-CAT-01, FR-CAT-10 minimal — Kawadir layout: summary cards, a toolbar with search and
 * filters, the list as a table in a card, add / edit in a dialog). Holders of tms.course.read see the
 * library (L&D Manager, Training Coordinator, HR Manager, Department Head); tms.course.manage adds and
 * edits, tms.course.archive archives and restores; the estimated costs show for tms.course_cost.read, in
 * the organization's currency (General settings). The Organization Admin has no training access (BR-IAM-4).
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
  const texts = {
    ...flattenTexts(messages.courses),
    required: common('required'),
    optional: common('optional'),
  };
  const errorTexts = data?.canManage || data?.canArchive ? await profileErrorTexts(locale) : {};
  const categoryName = (category: CourseCategoryRow) =>
    locale === 'ar' ? category.nameAr : category.nameEn;
  const deliveryTypes = DELIVERY_TYPES.map((value) => ({
    value,
    label: t(`deliveryTypes.${value}`),
  }));
  const dialogProps = data
    ? {
        categories: data.categories.map((c) => ({ id: c.id, name: categoryName(c) })),
        deliveryTypes,
        currency: data.currency,
        showCosts: data.canSeeCosts,
        preview: data.preview,
        texts,
        errors: errorTexts,
      }
    : null;

  return (
    <SuiteShell locale={locale} context={context} current="courses" path={coursesPath(current)}>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          data?.canManage && dialogProps ? <CourseDialog mode="create" {...dialogProps} /> : null
        }
      />
      <div className="flex flex-col gap-6">
        {failure ? (
          <Alert tone="warning" data-testid="courses-failure">
            {failure}
          </Alert>
        ) : null}
        {data?.preview ? (
          <Alert tone="info" data-testid="courses-not-configured">
            {t('notConfigured')}
          </Alert>
        ) : null}
        {invalidFilters ? <Alert tone="warning">{t('invalidFilters')}</Alert> : null}
        {data && dialogProps ? (
          <CoursesBody
            locale={locale}
            data={data}
            params={current}
            dialogProps={dialogProps}
            texts={texts}
            errors={errorTexts}
          />
        ) : null}
      </div>
    </SuiteShell>
  );
}

async function CoursesBody({
  locale,
  data,
  params,
  dialogProps,
  texts,
  errors,
}: {
  locale: AppLocale;
  data: CoursesPageData;
  params: CoursesParams;
  dialogProps: Omit<Parameters<typeof CourseDialog>[0], 'mode' | 'course'>;
  texts: Readonly<Record<string, string>>;
  errors: Readonly<Record<string, string>>;
}) {
  const t = await getTranslations({ locale, namespace: 'courses' });
  const format = await getFormatter({ locale });
  const integer = (n: number) => format.number(n, 'integer');
  const amount = (value: number, currency: string) =>
    format.number(value, { style: 'currency', currency, maximumFractionDigits: 2 });
  const categories = new Map(data.categories.map((c) => [c.id, c]));
  const filtered = isFiltered(params);
  const other = locale === 'ar' ? 'en' : 'ar';
  const title = (course: CourseRow) => (locale === 'ar' ? course.titleAr : course.titleEn);
  const otherTitle = (course: CourseRow) => (other === 'ar' ? course.titleAr : course.titleEn);
  const showActions = data.canManage || data.canArchive;

  return (
    <>
      <StatGrid label={t('statsLabel')} data-testid="courses-stats">
        <StatCard
          variant="gradient"
          label={t('stats.total')}
          value={integer(data.counts.total)}
          icon="courses"
        />
        <StatCard
          variant="gradient"
          label={t('stats.active')}
          value={integer(data.counts.active)}
          icon="success"
        />
        <StatCard
          variant="gradient"
          label={t('stats.archived')}
          value={integer(data.counts.archived)}
          icon="archive"
        />
      </StatGrid>

      <form
        method="get"
        action={`/${locale}/suite/courses`}
        aria-label={t('filtersLabel')}
        className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5 xl:items-end"
        data-testid="courses-filters"
      >
        <div className="flex flex-col gap-1 xl:col-span-2">
          <label htmlFor="courses-q" className="text-sm font-medium">
            {t('search')}
          </label>
          <input
            id="courses-q"
            name="q"
            type="search"
            maxLength={100}
            defaultValue={params.q ?? ''}
            aria-describedby="courses-q-hint"
            className={toolbarFieldClasses}
          />
          <p id="courses-q-hint" className="m-0 text-xs text-text-muted">
            {t('searchHint')}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="courses-category" className="text-sm font-medium">
            {t('category')}
          </label>
          <select
            id="courses-category"
            name="category"
            defaultValue={params.category ?? ''}
            className={selectClass}
          >
            <option value="">{t('allCategories')}</option>
            {data.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {locale === 'ar' ? category.nameAr : category.nameEn}
              </option>
            ))}
            <option value="none">{t('noCategory')}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="courses-type" className="text-sm font-medium">
            {t('deliveryType')}
          </label>
          <select
            id="courses-type"
            name="type"
            defaultValue={params.type ?? ''}
            className={selectClass}
          >
            <option value="">{t('allDeliveryTypes')}</option>
            {DELIVERY_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`deliveryTypes.${type}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="courses-status" className="text-sm font-medium">
            {t('status')}
          </label>
          <select
            id="courses-status"
            name="status"
            defaultValue={params.status ?? ''}
            className={selectClass}
          >
            <option value="">{t('allStatuses')}</option>
            <option value="active">{t('statuses.active')}</option>
            <option value="archived">{t('statuses.archived')}</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2 xl:col-span-5">
          <button type="submit" className={buttonClasses({ variant: 'secondary', size: 'md' })}>
            <Icon name="search" />
            {t('apply')}
          </button>
          {filtered ? (
            <a
              href={coursesHref(locale, {})}
              className={buttonClasses({ variant: 'ghost', size: 'md' })}
            >
              {t('clearFilters')}
            </a>
          ) : null}
        </div>
      </form>

      {data.truncated ? <Alert tone="info">{t('truncated')}</Alert> : null}

      {data.courses.length === 0 ? (
        <Card data-testid="courses-empty">
          <EmptyState
            icon="courses"
            title={filtered ? t('emptyFilteredTitle') : t('emptyTitle')}
            description={filtered ? t('emptyFilteredBody') : t('emptyBody')}
          />
        </Card>
      ) : (
        <Card flush>
          <div className={tableClasses.wrapper}>
            <table className={tableClasses.table} data-testid="courses-table">
              <caption className="sr-only">{t('tableCaption')}</caption>
              <thead className={tableClasses.header}>
                <tr>
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.code')}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.title')}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.category')}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.deliveryType')}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.duration')}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.participants')}
                  </th>
                  {data.canSeeCosts ? (
                    <th scope="col" className={tableClasses.head}>
                      {t('columns.cost')}
                    </th>
                  ) : null}
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.status')}
                  </th>
                  {showActions ? (
                    <th scope="col" className={`${tableClasses.head} text-end`}>
                      {t('columns.actions')}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {data.courses.map((course) => {
                  const category = course.categoryId
                    ? categories.get(course.categoryId)
                    : undefined;
                  const currency = course.costCurrency ?? data.currency;
                  return (
                    <tr
                      key={course.id}
                      className={tableClasses.row}
                      data-testid={`course-row-${course.code}`}
                    >
                      <td className={tableClasses.cell}>
                        <bdi dir="ltr" className="font-medium">
                          {course.code}
                        </bdi>
                      </td>
                      <td className={`${tableClasses.cell} max-w-xs`}>
                        <div className="flex flex-col">
                          <span className="font-medium">{title(course)}</span>
                          <span className="text-xs text-text-muted" lang={other} dir="auto">
                            {otherTitle(course)}
                          </span>
                        </div>
                      </td>
                      <td className={tableClasses.cell}>
                        {category ? (
                          locale === 'ar' ? (
                            category.nameAr
                          ) : (
                            category.nameEn
                          )
                        ) : (
                          <span className="text-text-muted">{t('noCategory')}</span>
                        )}
                      </td>
                      <td className={tableClasses.cell}>
                        <Badge tone="neutral">{t(`deliveryTypes.${course.deliveryType}`)}</Badge>
                      </td>
                      <td className={`${tableClasses.cell} whitespace-nowrap`}>
                        {t('hours', { count: course.durationHours })}
                        {course.durationDays !== null ? (
                          <span className="text-text-muted">
                            {' · '}
                            {t('days', { count: course.durationDays })}
                          </span>
                        ) : null}
                      </td>
                      <td className={`${tableClasses.cell} whitespace-nowrap`}>
                        {t('participantsRange', {
                          min: integer(course.minParticipants),
                          max: integer(course.maxParticipants),
                        })}
                      </td>
                      {data.canSeeCosts ? (
                        <td className={tableClasses.cell} data-testid="course-cost">
                          {course.estCostPerSession === null &&
                          course.estCostPerParticipant === null ? (
                            <span className="text-text-muted">{t('notEstimated')}</span>
                          ) : (
                            <div className="flex flex-col whitespace-nowrap">
                              {course.estCostPerSession !== null ? (
                                <span>
                                  {t('perSession', {
                                    amount: amount(course.estCostPerSession, currency),
                                  })}
                                </span>
                              ) : null}
                              {course.estCostPerParticipant !== null ? (
                                <span className="text-xs text-text-muted">
                                  {t('perParticipant', {
                                    amount: amount(course.estCostPerParticipant, currency),
                                  })}
                                </span>
                              ) : null}
                            </div>
                          )}
                        </td>
                      ) : null}
                      <td className={tableClasses.cell}>
                        <Badge tone={course.status === 'active' ? 'success' : 'neutral'}>
                          {t(`statuses.${course.status}`)}
                        </Badge>
                      </td>
                      {showActions ? (
                        <td className={`${tableClasses.cell} text-end`}>
                          <div className="flex items-center justify-end gap-1">
                            {data.canManage && course.status === 'active' ? (
                              <CourseDialog mode="edit" course={course} {...dialogProps} />
                            ) : null}
                            {data.canArchive ? (
                              <CourseStatusButton
                                id={course.id}
                                version={course.version}
                                code={course.code}
                                title={title(course)}
                                action={course.status === 'active' ? 'archive' : 'restore'}
                                preview={data.preview}
                                texts={texts}
                                errors={errors}
                              />
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
