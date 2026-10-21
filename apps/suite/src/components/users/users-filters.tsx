'use client';
import { FilterBar, FilterMenu, type FilterMenuOption, ListSearch } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useEffect, useRef, useState, useTransition } from 'react';
import { type UsersListParams, usersListHref } from '../../lib/users-list-href';

export interface UsersFilterChoice {
  /** The filter's name («الدور» / "Role"). */
  readonly label: string;
  /** «كل الأدوار» / "All roles". */
  readonly allLabel: string;
  readonly options: readonly FilterMenuOption[];
}

export interface UsersFiltersProps {
  readonly locale: 'ar' | 'en';
  readonly params: UsersListParams;
  readonly searchLabel: string;
  readonly searchPlaceholder: string;
  /** Each filter only when the member may use it (roles: role.read; units and branches: org.read). */
  readonly role: UsersFilterChoice | null;
  readonly unit: UsersFilterChoice | null;
  readonly branch: UsersFilterChoice | null;
  /** «إزالة عامل التصفية {filter}» (raw), «ابحث في القائمة», «لا شيء يطابق البحث.» */
  readonly texts: {
    readonly removeFilter: string;
    readonly findInList: string;
    readonly noMatches: string;
  };
  /** «Showing 1–10 of 42» (formatted on the server), announced politely when it changes. */
  readonly range: string | null;
}

/** Milliseconds the search waits after the last key before it applies (the list is a server read). */
const SEARCH_PAUSE = 400;

/**
 * The search pill and filter pills of Team members (redesign package 3 — Attio, Mercury): every change
 * applies at once — no Apply button — and stays in the address (`?q=&role=&department=&branch=`), so a
 * filtered list can still be bookmarked and shared; the search waits until typing pauses. The server reads
 * the list again with the same validated query as before; the result count is announced politely.
 */
export function UsersFilters(props: UsersFiltersProps) {
  const { locale, params } = props;
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState(params.q ?? '');
  const timer = useRef<number | undefined>(undefined);
  // The latest params (the pills may change while a search waits).
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  }, [params]);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  const go = (changes: Partial<Record<keyof UsersListParams, string | undefined>>) => {
    startTransition(() => {
      router.replace(usersListHref(locale, latest.current, { ...changes, page: undefined }), {
        scroll: false,
      });
    });
  };

  const applySearch = (value: string) => {
    window.clearTimeout(timer.current);
    const q = value.trim();
    if (q === (latest.current.q ?? '')) return;
    go({ q: q === '' ? undefined : q });
  };

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    applySearch(query);
  };

  const pill = (key: 'role' | 'department' | 'branch', choice: UsersFilterChoice | null) => {
    if (!choice) return null;
    const value = params[key] ?? null;
    const chosen = choice.options.find((o) => o.value === value);
    return (
      <FilterMenu
        label={choice.label}
        value={chosen ? value : null}
        options={choice.options}
        allLabel={choice.allLabel}
        onChange={(next) => {
          go({ [key]: next ?? undefined });
        }}
        removeLabel={props.texts.removeFilter.replace(
          '{filter}',
          `${choice.label}: ${chosen?.label ?? ''}`,
        )}
        searchLabel={props.texts.findInList}
        noMatches={props.texts.noMatches}
        data-testid={`users-filter-${key}`}
      />
    );
  };

  return (
    <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
      <form role="search" onSubmit={onSubmit} className="w-full md:w-auto">
        <ListSearch
          id="users-q"
          label={props.searchLabel}
          placeholder={props.searchPlaceholder}
          maxLength={100}
          value={query}
          autoComplete="off"
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => {
              applySearch(value);
            }, SEARCH_PAUSE);
          }}
        />
      </form>
      <FilterBar>
        {pill('role', props.role)}
        {pill('department', props.unit)}
        {pill('branch', props.branch)}
      </FilterBar>
      <p
        role="status"
        aria-live="polite"
        className="m-0 text-sm text-text-muted md:ms-auto"
        data-testid="users-range"
      >
        {props.range}
      </p>
    </div>
  );
}
