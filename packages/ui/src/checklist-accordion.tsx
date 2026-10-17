'use client';
import { type ReactNode, useState } from 'react';
import { Badge } from './badge';
import { cn } from './cn';
import { Icon } from './icons';

export interface ChecklistItem {
  /** The value the checkbox stands for (e.g. a permission code). */
  readonly value: string;
  readonly label: ReactNode;
  readonly description?: ReactNode;
  /** A badge next to the label, e.g. «عالي الخطورة» / "High risk". */
  readonly badge?: ReactNode;
  readonly checked: boolean;
  readonly disabled?: boolean;
  /** Why the item is disabled (shown under it and announced with it). */
  readonly note?: ReactNode;
}

export interface ChecklistGroup {
  readonly key: string;
  readonly title: ReactNode;
  readonly items: readonly ChecklistItem[];
}

export interface ChecklistAccordionProps {
  readonly groups: readonly ChecklistGroup[];
  /** Called when an item is ticked or cleared (not called when read-only). */
  readonly onToggle?: (value: string, checked: boolean) => void;
  /** View only (e.g. a standard role): checkboxes shown, not changeable. */
  readonly readOnly?: boolean;
  /**
   * «٢ من ٥ محددة» / "2 of 5 selected" — the screen-reader text of each group's count badge: a function, or
   * (from a server component) a text with `{checked}` and `{total}`.
   */
  readonly countLabel: string | ((checked: number, total: number) => string);
  /** Prefix of the element ids (unique per page). */
  readonly idPrefix: string;
  /** Groups open at first: all, or only those with ticked items (default). */
  readonly defaultOpen?: 'all' | 'checked';
  readonly className?: string;
  readonly 'data-testid'?: string;
}

function countText(
  label: ChecklistAccordionProps['countLabel'],
  checked: number,
  total: number,
): string {
  if (typeof label === 'function') return label(checked, total);
  return label.replace('{checked}', String(checked)).replace('{total}', String(total));
}

/**
 * Checkboxes grouped in collapsible sections, each heading with a «ticked / total» badge (Kawadir's
 * permissions accordion of the roles screen). Built on native `<details>`/`<summary>` (keyboard and
 * screen readers know them; no script needed to open) and native checkboxes; logical properties only, so
 * it mirrors in Arabic. Disabled items say why under the label (linked with aria-describedby).
 */
export function ChecklistAccordion({
  groups,
  onToggle,
  readOnly = false,
  countLabel,
  idPrefix,
  defaultOpen = 'checked',
  className,
  'data-testid': testId,
}: ChecklistAccordionProps) {
  // Which groups start open is decided once: afterwards the person opens and closes them (ticking the
  // last item of a group never folds it away under the pointer).
  const [startsOpen] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        groups
          .filter((group) => defaultOpen === 'all' || group.items.some((item) => item.checked))
          .map((group) => group.key),
      ),
  );
  return (
    <div
      className={cn(
        'flex flex-col divide-y divide-border rounded-xl border border-border',
        className,
      )}
      data-testid={testId}
    >
      {groups.map((group) => {
        const checked = group.items.filter((item) => item.checked).length;
        const total = group.items.length;
        return (
          <details
            key={group.key}
            className="group"
            open={startsOpen.has(group.key) || undefined}
            data-testid={`${idPrefix}-group-${group.key}`}
          >
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-medium hover:bg-surface-hover [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <Icon
                  name="chevron-down"
                  className="text-text-muted transition-transform group-open:rotate-180"
                />
                {group.title}
              </span>
              <Badge tone={checked > 0 ? 'info' : 'neutral'}>
                <span aria-hidden="true">
                  {checked}/{total}
                </span>
                <span className="sr-only">{countText(countLabel, checked, total)}</span>
              </Badge>
            </summary>
            <ul className="m-0 flex list-none flex-col gap-1 px-2 pb-3 pt-1">
              {group.items.map((item) => {
                const id = `${idPrefix}-${item.value.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
                const describedBy = [
                  item.description ? `${id}-description` : null,
                  item.note ? `${id}-note` : null,
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <li key={item.value}>
                    <div className="flex items-start gap-3 rounded-lg p-2 hover:bg-surface-hover">
                      <input
                        id={id}
                        type="checkbox"
                        className="mt-0.5 size-5 shrink-0 accent-primary"
                        checked={item.checked}
                        disabled={readOnly || item.disabled}
                        aria-describedby={describedBy || undefined}
                        onChange={(event) => onToggle?.(item.value, event.target.checked)}
                      />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <label
                          htmlFor={id}
                          className="flex flex-wrap items-center gap-2 text-sm font-medium"
                        >
                          {item.label}
                          {item.badge}
                        </label>
                        {item.description ? (
                          <p id={`${id}-description`} className="m-0 text-sm text-text-muted">
                            {item.description}
                          </p>
                        ) : null}
                        {item.note ? (
                          <p id={`${id}-note`} className="m-0 text-sm text-text-muted">
                            {item.note}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
