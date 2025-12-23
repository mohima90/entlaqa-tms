'use client';

import { motion } from 'framer-motion';
import {
  Search,
  FileX,
  Users,
  Calendar,
  BookOpen,
  Award,
  Plus,
  RefreshCw,
  AlertCircle,
  WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Loading Skeleton
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse bg-slate-200 dark:bg-slate-700 rounded', className)} />
  );
}

// Card Skeleton
export function CardSkeleton() {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
      <div className="flex items-center gap-4 mb-4">
        <Skeleton className="w-12 h-12 rounded-xl" />
        <div className="flex-1">
          <Skeleton className="h-5 w-32 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <Skeleton className="h-4 w-full mb-2" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

// Table Skeleton
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <Skeleton className="h-10 w-64" />
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-700">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="p-4 flex items-center gap-4">
            <Skeleton className="w-10 h-10 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-48 mb-2" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Stats Skeleton
export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <Skeleton className="w-8 h-8 rounded-lg mb-3" />
          <Skeleton className="h-8 w-20 mb-2" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

// Page Loading
export function PageLoading() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-32 rounded-xl" />
      </div>
      <StatsSkeleton />
      <TableSkeleton />
    </div>
  );
}

// Spinner
export function Spinner({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  return (
    <div className={cn('animate-spin text-entlaqa-600', sizeClasses[size], className)}>
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// Full Page Spinner
export function FullPageSpinner() {
  return (
    <div className="fixed inset-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center"
      >
        <Spinner size="lg" />
        <p className="mt-4 text-slate-600 dark:text-slate-400 font-medium">Loading...</p>
      </motion.div>
    </div>
  );
}

// Empty State Props
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
  className?: string;
}

// Empty State
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('text-center py-16 px-4', className)}
    >
      <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
        {icon || <FileX className="w-8 h-8 text-slate-400" />}
      </div>
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">{title}</h3>
      <p className="text-slate-500 max-w-sm mx-auto mb-6">{description}</p>
      {action && (
        <button onClick={action.onClick} className="btn-primary">
          {action.icon || <Plus className="w-4 h-4" />}
          {action.label}
        </button>
      )}
    </motion.div>
  );
}

// Preset Empty States
export function NoSearchResults({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <EmptyState
      icon={<Search className="w-8 h-8 text-slate-400" />}
      title="No results found"
      description={`No results match "${query}". Try adjusting your search or filters.`}
      action={{ label: 'Clear Search', onClick: onClear, icon: <RefreshCw className="w-4 h-4" /> }}
    />
  );
}

export function NoSessions({ onAdd }: { onAdd: () => void }) {
  return (
    <EmptyState
      icon={<Calendar className="w-8 h-8 text-slate-400" />}
      title="No sessions found"
      description="You haven't created any training sessions yet. Get started by creating your first session."
      action={{ label: 'Create Session', onClick: onAdd }}
    />
  );
}

export function NoCourses({ onAdd }: { onAdd: () => void }) {
  return (
    <EmptyState
      icon={<BookOpen className="w-8 h-8 text-slate-400" />}
      title="No courses found"
      description="Your course catalog is empty. Start building your training programs."
      action={{ label: 'Create Course', onClick: onAdd }}
    />
  );
}

export function NoLearners({ onAdd }: { onAdd: () => void }) {
  return (
    <EmptyState
      icon={<Users className="w-8 h-8 text-slate-400" />}
      title="No learners found"
      description="You haven't added any learners yet. Add learners manually or sync from your LMS."
      action={{ label: 'Add Learner', onClick: onAdd }}
    />
  );
}

export function NoCertificates() {
  return (
    <EmptyState
      icon={<Award className="w-8 h-8 text-slate-400" />}
      title="No certificates issued"
      description="Certificates will appear here after learners complete their training programs."
    />
  );
}

// Error State
interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ title = 'Something went wrong', message = 'An unexpected error occurred. Please try again.', onRetry }: ErrorStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center py-16 px-4"
    >
      <div className="w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
        <AlertCircle className="w-8 h-8 text-red-600" />
      </div>
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">{title}</h3>
      <p className="text-slate-500 max-w-sm mx-auto mb-6">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-primary">
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
      )}
    </motion.div>
  );
}

// Offline State
export function OfflineState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center py-16 px-4"
    >
      <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
        <WifiOff className="w-8 h-8 text-amber-600" />
      </div>
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">You're offline</h3>
      <p className="text-slate-500 max-w-sm mx-auto mb-6">
        Please check your internet connection and try again.
      </p>
      <button onClick={() => window.location.reload()} className="btn-primary">
        <RefreshCw className="w-4 h-4" />
        Refresh Page
      </button>
    </motion.div>
  );
}
