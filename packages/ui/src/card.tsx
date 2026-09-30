import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  readonly title?: ReactNode;
  /** Heading level for the title (keeps the document outline correct). */
  readonly headingLevel?: 2 | 3;
}

export function Card({ title, headingLevel = 2, className, children, ...props }: CardProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section
      className={cn('rounded-lg border border-border bg-surface p-6 shadow-1', className)}
      {...props}
    >
      {title ? <Heading className="mb-3 mt-0 text-lg font-semibold">{title}</Heading> : null}
      {children}
    </section>
  );
}
