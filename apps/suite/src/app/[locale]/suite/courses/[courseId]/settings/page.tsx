import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import {
  type CourseCategoryRow,
  type CourseRow,
  DELIVERY_TYPES,
  OFFERED_DELIVERY_TYPES,
  courseCategoryName,
  courseTitle,
} from '@jadarat/tms/courses';
import { Alert, Badge, type IconName, PageHeader, TabNav } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { CourseSettingsForm } from '../../../../../../components/courses/course-settings-form';
import { SuiteShell } from '../../../../../../components/suite-shell';
import { courseSettingsQuery } from '../../../../../../lib/courses-queries';
import {
  COURSE_SETTINGS_TABS,
  type CourseSettingsTab,
  PREVIEW_CATEGORIES,
  PREVIEW_COURSES,
  courseSettingsHref,
  courseSettingsPath,
  courseSettingsTab,
  coursesHref,
} from '../../../../../../lib/courses-view';
import { flattenTexts } from '../../../../../../lib/flatten-texts';
import { profileErrorTexts } from '../../../../../../lib/profile-texts';
import { getSuiteContext } from '../../../../../../lib/suite-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TAB_ICON: Readonly<Record<CourseSettingsTab, IconName>> = {
  about: 'courses',
  delivery: 'calendar',
  capacity: 'people',
};
const TAB_TITLE: Readonly<Record<CourseSettingsTab, string>> = {
  about: 'form.sectionAbout',
  delivery: 'form.sectionDelivery',
  capacity: 'form.sectionCapacity',
};

/** What the page shows: the query's answer, or an example course without a database. */
interface CourseSettingsData {
  readonly course: CourseRow;
  readonly categories: readonly CourseCategoryRow[];
  readonly currency: string;
  readonly canSeeCosts: boolean;
  readonly nameLanguage: 'ar' | 'en';
  readonly preview: boolean;
}

/**
 * A course's Settings (the Kawadir pattern — forms standard rule 9; WP-UX-01 c, T-M3-21; FR-CAT-01):
 * everything «Add course» does not ask, on the course's own page — its sections as tabs at the side («About
 * the course», «Delivery and duration», «Participants and cost»; each its own address) and one save bar for
 * the open section. Only a member who manages the library (tms.course.manage) changes a course: a reader
 * goes back to the library, where the course opens in its read panel. An archived course is restored
 * first (as before: only active courses are edited). Costs show for tms.course_cost.read.
 */
export default async function CourseSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; courseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, courseId } = await params;
  if (!hasLocale(routing.locales, locale) || !UUID_RE.test(courseId)) notFound();
  const query = await searchParams;
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'courses' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const tab = courseSettingsTab(query.tab);
  const libraryHref = coursesHref(locale, {});

  let data: CourseSettingsData | null = null;
  let failure: ReactNode = null;
  if (!context.live) {
    const course = PREVIEW_COURSES.find((c) => c.id === courseId);
    if (!course) notFound();
    data = {
      course,
      categories: PREVIEW_CATEGORIES,
      currency: 'SAR',
      canSeeCosts: true,
      // The example library is titled in both languages: the page's language is asked first.
      nameLanguage: locale,
      preview: true,
    };
  } else {
    const result = await courseSettingsQuery({ id: courseId });
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'NOT_FOUND' || error.code === 'VALIDATION_FAILED') notFound();
      const errors = await getTranslations({ locale, namespace: 'errors' });
      failure = (
        <Alert tone="warning" data-testid="courses-failure">
          {error.code === 'FORBIDDEN'
            ? errors('forbidden')
            : errors('internalError', { correlationId: error.correlationId ?? '' })}
        </Alert>
      );
    } else {
      // The settings change a course: without tms.course.manage the library shows it (read panel).
      if (!result.value.canManage) redirect(libraryHref);
      data = { ...result.value, preview: false };
    }
  }

  let title = t('settings.title');
  let description: ReactNode;
  let content: ReactNode = failure;
  if (data) {
    const page = data;
    const { course } = page;
    title = courseTitle(course, locale);
    description = (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <bdi dir="ltr" className="font-mono text-[13px] font-semibold text-text">
          {course.code}
        </bdi>
        <Badge tone={course.status === 'active' ? 'success' : 'neutral'} dot>
          {t(`statuses.${course.status}`)}
        </Badge>
        {t('settings.title')}
      </span>
    );
    if (course.status !== 'active') {
      content = (
        <Alert tone="info" data-testid="course-settings-archived">
          {t('settings.archived')}
        </Alert>
      );
    } else {
      const messages = await getMessages({ locale });
      const texts = {
        ...flattenTexts(messages.courses),
        required: common('required'),
        optional: common('optional'),
        unsavedChanges: common('unsavedChanges'),
        discardChanges: common('discardChanges'),
        leaveTitle: common('leaveTitle'),
        leaveText: common('leaveText'),
        leaveStay: common('leaveStay'),
        leaveGo: common('leaveGo'),
      };
      content = (
        <div className="flex flex-col gap-4">
          {page.preview ? (
            <Alert tone="info" data-testid="courses-not-configured">
              {t('notConfigured')}
            </Alert>
          ) : null}
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[230px_minmax(0,1fr)] xl:gap-6">
            <TabNav
              variant="side"
              label={t('settings.title')}
              current={tab}
              items={COURSE_SETTINGS_TABS.map((key) => ({
                key,
                href: courseSettingsHref(locale, course.id, key),
                label: t(TAB_TITLE[key]),
                icon: TAB_ICON[key],
              }))}
              className="xl:sticky xl:top-24"
              data-testid="course-settings-tabs"
            />
            <CourseSettingsForm
              // Each section starts from the stored course (its own address, its own unsaved changes).
              key={tab}
              tab={tab}
              course={course}
              categories={page.categories.map((c) => ({
                id: c.id,
                name: courseCategoryName(c, locale),
              }))}
              deliveryTypes={OFFERED_DELIVERY_TYPES.map((value) => ({
                value,
                label: t(`deliveryTypes.${value}`),
              }))}
              // A stored course may still have one of the other types: it keeps its label in the form.
              deliveryTypeLabels={Object.fromEntries(
                DELIVERY_TYPES.map((value) => [value, t(`deliveryTypes.${value}`)]),
              )}
              currency={page.currency}
              showCosts={page.canSeeCosts}
              nameLanguage={page.nameLanguage}
              preview={page.preview}
              texts={texts}
              errors={await profileErrorTexts(locale)}
            />
          </div>
        </div>
      );
    }
  }

  return (
    <SuiteShell
      locale={locale}
      context={context}
      current="courses"
      path={courseSettingsPath(courseId, tab)}
    >
      <PageHeader
        breadcrumbsLabel={common('breadcrumbLabel')}
        breadcrumbs={[{ label: t('title'), href: libraryHref }, { label: title }]}
        title={<span data-testid="course-settings-title">{title}</span>}
        description={description}
      />
      {content}
    </SuiteShell>
  );
}
