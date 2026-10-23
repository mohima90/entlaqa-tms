import { displayDateFormatter } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { EmptyState, Icon, PageHeader } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { type HomeTileGroup, HomeTiles } from '../../../components/home-tiles';
import { SuiteShell } from '../../../components/suite-shell';
import { TeamStats } from '../../../components/users/team-stats';
import { getSuiteContext } from '../../../lib/suite-context';
import {
  type NavLabelKey,
  SUITE_PATHS,
  suiteHome,
  suiteNavigation,
} from '../../../lib/suite-navigation';
import { invitationsListQuery, usersListQuery } from '../../../lib/users-queries';
import { localizedName, type TeamCounts, teamCounts } from '../../../lib/users-view';

/**
 * The team's figures for the Organization Admin home: the same reads, permissions and counts as the Team
 * members page (null when the member may not list users or the read fails — the band is left out).
 */
async function homeTeamCounts(): Promise<TeamCounts | null> {
  const result = await usersListQuery({});
  if (!result.ok) return null;
  const invitations = result.value.canInvite ? await invitationsListQuery({}) : null;
  return teamCounts(
    result.value.list.counts,
    invitations?.ok ? invitations.value.invitations.length : null,
  );
}

/** One line under a set-up tile: what the page is for (message keys of namespace `shell`). */
const SETUP_DESCRIPTION: Partial<Record<NavLabelKey, string>> = {
  teamMembers: 'setupStep.team',
  branding: 'setupStep.branding',
  roles: 'setupStep.roles',
  grades: 'setupStep.grades',
  general: 'setupStep.general',
  emailIntegration: 'setupStep.email',
  security: 'setupStep.security',
};

/**
 * Suite home (walking skeleton, T-M1-D03; redesign package 6, PO 21 Oct 2026). When sign-in is configured
 * the page requires a verified session WITH an organization (tenant claim) and shows that organization;
 * otherwise (local development, CI) it renders the data-less preview. Pages fail closed: no session →
 * sign-in. A greeting with the date in the organization's calendar; the Organization Admin gets the team's
 * figures (each linking to Team members on its tab) and the set-up card with one line per page; every
 * other role gets «Your pages» — the pages already in their menu — above the «No training data yet» state.
 * TODO(M2, ADR 0002 §4): host tenant (subdomain) must equal the claim tenant once tenant domains exist.
 */
export default async function SuiteHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'shell' });
  // The Organization Admin has no training features: until the admin home (FR-ADM-14) exists, a short
  // set-up card with the pages that are built today (T-M2-21). Decided on the server from the grants.
  const home = suiteHome(context.navigation);
  // Kawadir dashboard: the team's figures on the brand gradient above the set-up card (live data only).
  const counts = home.kind === 'setup' && context.live ? await homeTeamCounts() : null;
  const users = await getTranslations({ locale, namespace: 'users' });
  const format = await getFormatter({ locale });

  // The greeting: the first word of the member's name (the account menu's name), else the plain title.
  const fullName = context.me ? localizedName(locale, context.me.nameAr, context.me.nameEn) : '';
  const firstName = fullName.trim().split(/\s+/)[0] ?? '';
  const today = displayDateFormatter(
    locale,
    context.regional.dateDisplay,
    context.regional.timeZone,
  ).full(new Date());

  // The pages the member can open today — the menu's built pages, grouped like the menu (deny by default).
  const groups = suiteNavigation(context.navigation)
    .map((group) => ({
      key: group.key,
      entries: group.entries.filter((entry) => entry.link !== undefined && entry.key !== 'home'),
    }))
    .filter((group) => group.entries.length > 0);
  const tileOf = (entry: (typeof groups)[number]['entries'][number], description?: string) => ({
    key: entry.key,
    href: `/${locale}${entry.link?.href ?? ''}`,
    title: t(entry.key),
    icon: entry.icon,
    description,
  });
  const setupGroups: HomeTileGroup[] = groups.map((group) => ({
    key: group.key,
    heading: group.key === 'main' ? undefined : t(group.key),
    tiles: group.entries.map((entry) => {
      const description = SETUP_DESCRIPTION[entry.key];
      return tileOf(entry, description ? t(description) : undefined);
    }),
  }));
  const pageTiles = groups.flatMap((group) =>
    group.entries.map((entry) => tileOf(entry, group.key === 'main' ? undefined : t(group.key))),
  );
  // A member with Home only (an employee) still has their profile.
  const yourPages: HomeTileGroup[] = [
    {
      key: 'pages',
      tiles:
        pageTiles.length > 0
          ? pageTiles
          : [
              {
                key: 'profile',
                href: `/${locale}${SUITE_PATHS.profile}`,
                title: t('myProfile'),
                icon: 'user' as const,
                description: t('searchGroupAccount'),
              },
            ],
    },
  ];
  const [hintBefore = '', hintAfter = ''] = t('searchHint', { key: '\u0000' }).split('\u0000');

  const empty = (
    <section
      aria-label={t('emptyTitle')}
      className="rounded-2xl border border-border bg-surface px-5 py-5.5 shadow-2 md:px-7 md:py-6.5"
    >
      <div className="rounded-xl border border-dashed border-border-strong bg-surface-sunken">
        <EmptyState
          icon="calendar"
          title={t('emptyTitle')}
          description={t('emptyBody')}
          headingLevel={2}
        />
      </div>
    </section>
  );

  return (
    <SuiteShell locale={locale} context={context} current="home" path="/suite">
      <PageHeader
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-2 text-[14.5px] font-medium">
            <Icon name="calendar" className="size-4" />
            <span data-testid="home-date">{today}</span>
          </span>
        }
        title={firstName ? t('welcome', { name: firstName }) : t('pageTitle')}
        description={t('homeSubtitle')}
        gradient
      />
      {home.kind === 'setup' ? (
        <div className="flex flex-col gap-5.5">
          {counts ? (
            <TeamStats
              locale={locale}
              label={users('statsLabel')}
              counts={counts}
              texts={{
                total: users('stats.total'),
                active: users('stats.active'),
                pending: users('stats.pending'),
                deactivated: users('stats.deactivated'),
              }}
              format={(n) => format.number(n, 'integer')}
              data-testid="home-team-stats"
            />
          ) : null}
          <HomeTiles
            headingId="home-setup-title"
            title={t('setupTitle')}
            description={t('setupBody')}
            icon="settings"
            groups={setupGroups}
            data-testid="setup-home"
            footer={
              <p className="m-0 mt-5 hidden items-center gap-2.5 text-sm text-text-muted md:flex">
                <Icon name="search" className="size-4" />
                <span>
                  {hintBefore}
                  <kbd
                    dir="ltr"
                    className="rounded-md border border-border bg-surface-sunken px-1.5 py-0.5 font-mono text-xs"
                  >
                    Ctrl K
                  </kbd>
                  {hintAfter}
                </span>
              </p>
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-5.5">
          {pageTiles.length > 0 ? null : empty}
          <HomeTiles
            headingId="home-pages-title"
            title={t('yourPages')}
            description={t('yourPagesIntro')}
            icon="sessions"
            groups={yourPages}
            data-testid="your-pages"
          />
          {pageTiles.length > 0 ? empty : null}
        </div>
      )}
    </SuiteShell>
  );
}
