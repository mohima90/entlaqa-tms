'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus, LucideIcon } from 'lucide-react';
import { SourceDot } from '../shared/SourceBadge';

interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon: LucideIcon;
  iconColor?: string;
  iconBgColor?: string;
  breakdown?: {
    offline: number;
    lms: number;
  };
  delay?: number;
  className?: string;
}

export default function StatCard({
  title,
  value,
  change,
  changeLabel = 'vs last month',
  icon: Icon,
  iconColor = 'text-entlaqa-600',
  iconBgColor = 'bg-entlaqa-100 dark:bg-entlaqa-950/50',
  breakdown,
  delay = 0,
  className,
}: StatCardProps) {
  const getTrendIcon = () => {
    if (!change) return <Minus className="w-3 h-3" />;
    return change > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />;
  };

  const getTrendColor = () => {
    if (!change) return 'text-slate-500';
    return change > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className={cn(
        'bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700',
        'p-6 hover:shadow-glass transition-shadow duration-300',
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            {title}
          </p>
          <p className="mt-2 text-3xl font-display font-bold text-slate-900 dark:text-white">
            {value}
          </p>
          
          {/* Data Source Breakdown */}
          {breakdown && (
            <div className="flex items-center gap-4 mt-3">
              <div className="flex items-center gap-1.5">
                <SourceDot source="offline" size="sm" />
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  {breakdown.offline.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <SourceDot source="lms" size="sm" />
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  {breakdown.lms.toLocaleString()}
                </span>
              </div>
            </div>
          )}

          {/* Change Indicator */}
          {change !== undefined && (
            <div className="flex items-center gap-1.5 mt-3">
              <span className={cn('flex items-center gap-1 text-sm font-medium', getTrendColor())}>
                {getTrendIcon()}
                {Math.abs(change)}%
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {changeLabel}
              </span>
            </div>
          )}
        </div>

        <div className={cn('p-3 rounded-xl', iconBgColor)}>
          <Icon className={cn('w-6 h-6', iconColor)} />
        </div>
      </div>
    </motion.div>
  );
}

// Compact version for smaller displays
interface MiniStatProps {
  label: string;
  value: string | number;
  source?: 'offline' | 'lms';
  className?: string;
}

export function MiniStat({ label, value, source, className }: MiniStatProps) {
  return (
    <div className={cn('flex items-center justify-between py-2', className)}>
      <div className="flex items-center gap-2">
        {source && <SourceDot source={source} size="sm" />}
        <span className="text-sm text-slate-600 dark:text-slate-400">{label}</span>
      </div>
      <span className="text-sm font-semibold text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

// Progress stat with bar
interface ProgressStatProps {
  label: string;
  value: number;
  max: number;
  color?: string;
  showPercentage?: boolean;
  breakdown?: {
    offline: number;
    lms: number;
  };
  className?: string;
}

export function ProgressStat({
  label,
  value,
  max,
  color = 'bg-entlaqa-500',
  showPercentage = true,
  breakdown,
  className,
}: ProgressStatProps) {
  const percentage = Math.round((value / max) * 100);
  const offlinePercentage = breakdown ? Math.round((breakdown.offline / max) * 100) : 0;
  const lmsPercentage = breakdown ? Math.round((breakdown.lms / max) * 100) : 0;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-600 dark:text-slate-400">{label}</span>
        <span className="text-sm font-semibold text-slate-900 dark:text-white">
          {value.toLocaleString()} / {max.toLocaleString()}
          {showPercentage && (
            <span className="text-slate-500 dark:text-slate-400 ml-1">({percentage}%)</span>
          )}
        </span>
      </div>
      
      <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
        {breakdown ? (
          <div className="h-full flex">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${offlinePercentage}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="h-full bg-source-offline"
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${lmsPercentage}%` }}
              transition={{ duration: 0.5, ease: 'easeOut', delay: 0.2 }}
              className="h-full bg-source-lms"
            />
          </div>
        ) : (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className={cn('h-full', color)}
          />
        )}
      </div>

      {breakdown && (
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <SourceDot source="offline" size="sm" />
            <span className="text-slate-500">{breakdown.offline.toLocaleString()} offline</span>
          </div>
          <div className="flex items-center gap-1.5">
            <SourceDot source="lms" size="sm" />
            <span className="text-slate-500">{breakdown.lms.toLocaleString()} LMS</span>
          </div>
        </div>
      )}
    </div>
  );
}
