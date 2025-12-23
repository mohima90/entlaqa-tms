'use client';

import { cn } from '@/lib/utils';
import { Database, Cloud } from 'lucide-react';

type DataSource = 'offline' | 'lms';

interface SourceBadgeProps {
  source: DataSource;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function SourceBadge({ source, showLabel = true, size = 'md', className }: SourceBadgeProps) {
  const sizeClasses = {
    sm: 'px-1.5 py-0.5 text-[10px] gap-1',
    md: 'px-2.5 py-1 text-xs gap-1.5',
    lg: 'px-3 py-1.5 text-sm gap-2',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-3.5 h-3.5',
    lg: 'w-4 h-4',
  };

  if (source === 'offline') {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full font-medium',
          'bg-source-offline-light text-source-offline-dark border border-source-offline-border',
          sizeClasses[size],
          className
        )}
      >
        <Database className={iconSizes[size]} />
        {showLabel && <span>Offline</span>}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        'bg-source-lms-light text-source-lms-dark border border-source-lms-border',
        sizeClasses[size],
        className
      )}
    >
      <Cloud className={iconSizes[size]} />
      {showLabel && <span>LMS</span>}
    </span>
  );
}

interface SourceDotProps {
  source: DataSource;
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  className?: string;
}

export function SourceDot({ source, size = 'md', pulse = false, className }: SourceDotProps) {
  const sizeClasses = {
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-2.5 h-2.5',
  };

  return (
    <span
      className={cn(
        'inline-block rounded-full',
        source === 'offline' ? 'bg-source-offline' : 'bg-source-lms',
        sizeClasses[size],
        pulse && 'animate-pulse',
        className
      )}
      title={source === 'offline' ? 'Offline Record' : 'LMS Record'}
    />
  );
}

interface SourceIndicatorProps {
  source: DataSource;
  showLabel?: boolean;
  className?: string;
}

export function SourceIndicator({ source, showLabel = true, className }: SourceIndicatorProps) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <SourceDot source={source} />
      {showLabel && (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {source === 'offline' ? 'Offline' : 'LMS'}
        </span>
      )}
    </div>
  );
}

// Card with source indicator border
interface SourceCardProps {
  source: DataSource;
  children: React.ReactNode;
  className?: string;
}

export function SourceCard({ source, children, className }: SourceCardProps) {
  return (
    <div
      className={cn(
        'bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700',
        'border-l-4',
        source === 'offline' ? 'border-l-source-offline' : 'border-l-source-lms',
        className
      )}
    >
      {children}
    </div>
  );
}

// Source filter buttons
interface SourceFilterProps {
  value: DataSource | 'all';
  onChange: (value: DataSource | 'all') => void;
  counts?: { all: number; offline: number; lms: number };
  className?: string;
}

export function SourceFilter({ value, onChange, counts, className }: SourceFilterProps) {
  return (
    <div className={cn('inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl', className)}>
      <button
        onClick={() => onChange('all')}
        className={cn(
          'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
          value === 'all'
            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
        )}
      >
        All {counts && <span className="ml-1 text-slate-400">({counts.all})</span>}
      </button>
      <button
        onClick={() => onChange('offline')}
        className={cn(
          'px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5',
          value === 'offline'
            ? 'bg-white dark:bg-slate-700 text-source-offline-dark shadow-sm'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
        )}
      >
        <SourceDot source="offline" size="sm" />
        Offline {counts && <span className="text-slate-400">({counts.offline})</span>}
      </button>
      <button
        onClick={() => onChange('lms')}
        className={cn(
          'px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5',
          value === 'lms'
            ? 'bg-white dark:bg-slate-700 text-source-lms-dark shadow-sm'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
        )}
      >
        <SourceDot source="lms" size="sm" />
        LMS {counts && <span className="text-slate-400">({counts.lms})</span>}
      </button>
    </div>
  );
}
