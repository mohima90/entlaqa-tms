'use client';
import { Badge, Icon, ListSearch } from '@jadarat/ui';
import { useState } from 'react';
import { fillText } from '../../lib/fill-text';
import type { BuilderGroup } from '../../lib/role-builder';

/**
 * A role's permissions, read only (redesign package 3 — Shopify's role permissions, Langdock's allowed /
 * not allowed): a search, then the catalogue by module, each group with «n of m selected» and every
 * permission marked «Allowed» or «Not allowed» in words with an icon (no ticked-but-disabled checkboxes),
 * high-risk ones tagged.
 */
export function PermissionsView({
  groups,
  chosen,
  texts,
  locale,
}: {
  readonly groups: readonly BuilderGroup[];
  readonly chosen: readonly string[];
  /** searchPermissions, allowed, notAllowed, highRisk, countLabel (raw), noMatches. */
  readonly texts: Readonly<Record<string, string>>;
  readonly locale: 'ar' | 'en';
}) {
  const [query, setQuery] = useState('');
  const text = (key: string) => texts[key] ?? key;
  const held = new Set(chosen);
  const needle = query.trim().toLocaleLowerCase();
  const shown = groups
    .map((group) => ({
      ...group,
      permissions: needle
        ? group.permissions.filter((p) =>
            `${p.label} ${p.description}`.toLocaleLowerCase().includes(needle),
          )
        : group.permissions,
    }))
    .filter((group) => group.permissions.length > 0);
  return (
    <div className="flex flex-col gap-3.5" data-testid="role-permissions">
      <ListSearch
        id="role-permission-search"
        label={text('searchPermissions')}
        placeholder={text('searchPermissions')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      {shown.length === 0 ? (
        <p role="status" className="m-0 text-text-muted">
          {text('noMatches')}
        </p>
      ) : null}
      {shown.map((group) => {
        const all = groups.find((g) => g.key === group.key)?.permissions ?? [];
        const checked = all.filter((p) => held.has(p.code)).length;
        return (
          <section
            key={group.key}
            aria-labelledby={`perm-group-${group.key}`}
            className="overflow-hidden rounded-lg border border-border bg-surface"
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-sunken px-4 py-3">
              <h3 id={`perm-group-${group.key}`} className="m-0 flex-1 text-base font-semibold">
                {group.title}
              </h3>
              <Badge tone="neutral">
                {fillText(text('countLabel'), { checked, total: all.length }, locale)}
              </Badge>
            </div>
            <ul className="m-0 list-none p-0">
              {group.permissions.map((permission) => {
                const allowed = held.has(permission.code);
                return (
                  <li
                    key={permission.code}
                    className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0"
                    data-testid={`permission-${permission.code}`}
                    data-allowed={allowed}
                  >
                    <span
                      aria-hidden="true"
                      className={
                        allowed
                          ? 'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-success-subtle text-success'
                          : 'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-surface-sunken text-text-muted'
                      }
                    >
                      <Icon name={allowed ? 'check' : 'close'} className="size-3.5" />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={allowed ? 'font-semibold' : 'text-text-muted'}>
                          {permission.label}
                        </span>
                        {permission.highRisk ? (
                          <Badge tone="warning">{text('highRisk')}</Badge>
                        ) : null}
                      </span>
                      <span className="text-[13px] text-text-muted">
                        {allowed ? text('allowed') : text('notAllowed')}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
