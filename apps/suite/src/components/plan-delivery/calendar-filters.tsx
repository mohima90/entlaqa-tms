'use client';
import { FilterMenu, type FilterMenuOption } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export interface CalendarFiltersProps {
  /** The address of the calendar with `__branch__` / `__course__` where the chosen value goes. */
  readonly hrefs: { readonly branch: string; readonly course: string };
  readonly branch: { readonly value: string | null; readonly options: readonly FilterMenuOption[] };
  readonly course: { readonly value: string | null; readonly options: readonly FilterMenuOption[] };
  readonly texts: {
    readonly branch: string;
    readonly allBranches: string;
    readonly removeBranch: string;
    readonly course: string;
    readonly allCourses: string;
    readonly removeCourse: string;
    readonly search: string;
    readonly noMatches: string;
  };
}

/**
 * The calendar's branch and course filters (WP-LD-04, design screen 4): pills that apply at once (FilterMenu) and
 * move to the calendar's address with the filter set — every view of the calendar is its own address.
 */
export function CalendarFilters({ hrefs, branch, course, texts }: CalendarFiltersProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const go = (template: string, key: string, value: string | null) => {
    const url = new URL(template.replace(`__${key}__`, value ?? ''), window.location.origin);
    if (!value) url.searchParams.delete(key);
    startTransition(() => {
      router.push(`${url.pathname}${url.search}`, { scroll: false });
    });
  };
  return (
    <>
      <FilterMenu
        label={texts.branch}
        value={branch.value}
        options={branch.options}
        allLabel={texts.allBranches}
        removeLabel={texts.removeBranch}
        searchLabel={texts.search}
        noMatches={texts.noMatches}
        onChange={(value) => {
          go(hrefs.branch, 'branch', value);
        }}
        data-testid="calendar-filter-branch"
      />
      <FilterMenu
        label={texts.course}
        value={course.value}
        options={course.options}
        allLabel={texts.allCourses}
        removeLabel={texts.removeCourse}
        searchLabel={texts.search}
        noMatches={texts.noMatches}
        onChange={(value) => {
          go(hrefs.course, 'course', value);
        }}
        data-testid="calendar-filter-course"
      />
    </>
  );
}
