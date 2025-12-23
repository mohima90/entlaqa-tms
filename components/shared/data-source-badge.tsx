'use client'

import { cn } from '@/lib/utils'
import { PenLine, CloudDownload, Webhook, FileUp, Info, WifiOff } from 'lucide-react'
import { DataSource } from '@/types/database'
import { motion } from 'framer-motion'
import { useState } from 'react'

interface DataSourceBadgeProps {
  source: DataSource
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  showTooltip?: boolean
  className?: string
}

const config = {
  manual: {
    label: 'Manual',
    labelAr: 'يدوي',
    description: 'Added manually in TMS',
    descriptionAr: 'مضاف يدوياً في النظام',
    icon: PenLine,
    bgColor: 'bg-emerald-500/10',
    textColor: 'text-emerald-400',
    borderColor: 'border-emerald-500/20',
    dotColor: 'bg-emerald-500',
    glowColor: 'shadow-emerald-500/20',
  },
  lms: {
    label: 'LMS',
    labelAr: 'نظام التعلم',
    description: 'Synced from Jadarat LMS',
    descriptionAr: 'مزامن من نظام جدارات',
    icon: CloudDownload,
    bgColor: 'bg-blue-500/10',
    textColor: 'text-blue-400',
    borderColor: 'border-blue-500/20',
    dotColor: 'bg-blue-500',
    glowColor: 'shadow-blue-500/20',
  },
  api: {
    label: 'API',
    labelAr: 'واجهة برمجية',
    description: 'Imported via API integration',
    descriptionAr: 'مستورد عبر الواجهة البرمجية',
    icon: Webhook,
    bgColor: 'bg-purple-500/10',
    textColor: 'text-purple-400',
    borderColor: 'border-purple-500/20',
    dotColor: 'bg-purple-500',
    glowColor: 'shadow-purple-500/20',
  },
  bulk_import: {
    label: 'Import',
    labelAr: 'استيراد',
    description: 'Bulk imported from file',
    descriptionAr: 'مستورد من ملف',
    icon: FileUp,
    bgColor: 'bg-amber-500/10',
    textColor: 'text-amber-400',
    borderColor: 'border-amber-500/20',
    dotColor: 'bg-amber-500',
    glowColor: 'shadow-amber-500/20',
  },
  offline: {
    label: 'Offline',
    labelAr: 'غير متصل',
    description: 'Created offline',
    descriptionAr: 'تم الإنشاء دون اتصال',
    icon: WifiOff,
    bgColor: 'bg-slate-500/10',
    textColor: 'text-slate-400',
    borderColor: 'border-slate-500/20',
    dotColor: 'bg-slate-500',
    glowColor: 'shadow-slate-500/20',
  },
}

const sizes = {
  sm: {
    badge: 'px-2 py-0.5 text-[10px] gap-1',
    icon: 'w-3 h-3',
    dot: 'w-1.5 h-1.5',
  },
  md: {
    badge: 'px-2.5 py-1 text-xs gap-1.5',
    icon: 'w-3.5 h-3.5',
    dot: 'w-2 h-2',
  },
  lg: {
    badge: 'px-3 py-1.5 text-sm gap-2',
    icon: 'w-4 h-4',
    dot: 'w-2.5 h-2.5',
  },
}

export function DataSourceBadge({
  source,
  size = 'md',
  showLabel = true,
  showTooltip = true,
  className,
}: DataSourceBadgeProps) {
  const [showTip, setShowTip] = useState(false)
  
  // Safe access using type assertion to fix build error
  const sourceConfig = config[source as keyof typeof config] || config.manual
  const Icon = sourceConfig.icon

  return (
    <div className="relative inline-flex">
      <motion.div
        className={cn(
          'inline-flex items-center rounded-full font-medium',
          'border backdrop-blur-sm cursor-default',
          'transition-all duration-200',
          sourceConfig.bgColor,
          sourceConfig.textColor,
          sourceConfig.borderColor,
          sizes[size].badge,
          className
        )}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        whileHover={{ scale: 1.02 }}
      >
        {/* Animated dot for LMS to show sync status */}
        {source === 'lms' ? (
          <span className={cn('rounded-full animate-pulse', sourceConfig.dotColor, sizes[size].dot)} />
        ) : (
          <Icon className={sizes[size].icon} />
        )}
        {showLabel && <span>{sourceConfig.label}</span>}
      </motion.div>

      {/* Tooltip */}
      {showTooltip && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: showTip ? 1 : 0, y: showTip ? 0 : 5 }}
          className={cn(
            'absolute bottom-full left-1/2 -translate-x-1/2 mb-2',
            'px-3 py-2 rounded-lg',
            'bg-gray-900/95 backdrop-blur-sm border border-white/10',
            'text-xs text-white/90 whitespace-nowrap',
            'pointer-events-none z-50',
            showTip ? 'visible' : 'invisible'
          )}
        >
          <div className="font-medium mb-0.5">{sourceConfig.label}</div>
          <div className="text-white/50">{sourceConfig.description}</div>
          {/* Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
            <div className="border-4 border-transparent border-t-gray-900/95" />
          </div>
        </motion.div>
      )}
    </div>
  )
}

// Data Source Indicator Dot (minimal version for tables)
interface DataSourceDotProps {
  source: DataSource
  size?: 'sm' | 'md'
  showTooltip?: boolean
}

export function DataSourceDot({ source, size = 'md', showTooltip = true }: DataSourceDotProps) {
  const [showTip, setShowTip] = useState(false)
  const sourceConfig = config[source as keyof typeof config] || config.manual

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      <span
        className={cn(
          'rounded-full',
          sourceConfig.dotColor,
          source === 'lms' && 'animate-pulse',
          size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5'
        )}
      />
      
      {showTooltip && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: showTip ? 1 : 0, scale: showTip ? 1 : 0.95 }}
          className={cn(
            'absolute bottom-full left-1/2 -translate-x-1/2 mb-2',
            'px-2 py-1 rounded',
            'bg-gray-900 border border-white/10',
            'text-[10px] font-medium whitespace-nowrap',
            sourceConfig.textColor,
            'pointer-events-none z-50',
            showTip ? 'visible' : 'invisible'
          )}
        >
          {sourceConfig.label}
        </motion.div>
      )}
    </div>
  )
}

// Data Source Legend Component (for dashboards/reports)
interface DataSourceLegendProps {
  sources?: DataSource[]
  orientation?: 'horizontal' | 'vertical'
  className?: string
}

export function DataSourceLegend({
  sources = ['manual', 'lms'] as any, // THIS IS THE CRITICAL FIX
  orientation = 'horizontal',
  className,
}: DataSourceLegendProps) {
  return (
    <div
      className={cn(
        'flex gap-4',
        orientation === 'vertical' && 'flex-col gap-2',
        className
      )}
    >
      {sources.map((source) => {
        const sourceConfig = config[source as keyof typeof config] || config.manual
        return (
          <div key={source} className="flex items-center gap-2">
            <span className={cn('w-3 h-3 rounded-full', sourceConfig.dotColor)} />
            <span className="text-xs text-white/60">{sourceConfig.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// Data Source Filter Tabs
interface DataSourceFilterProps {
  value: DataSource | 'all'
  onChange: (value: DataSource | 'all') => void
  counts?: { all: number; manual: number; lms: number }
  className?: string
}

export function DataSourceFilter({ value, onChange, counts, className }: DataSourceFilterProps) {
  const tabs = [
    { id: 'all', label: 'All', count: counts?.all },
    { id: 'manual', label: 'Manual', count: counts?.manual, ...config.manual },
    { id: 'lms', label: 'LMS', count: counts?.lms, ...config.lms },
  ]

  return (
    <div className={cn('flex p-1 rounded-xl bg-white/[0.03] border border-white/[0.08]', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id as DataSource | 'all')}
          className={cn(
            'relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
            'transition-all duration-200',
            value === tab.id
              ? 'text-white'
              : 'text-white/50 hover:text-white/70'
          )}
        >
          {value === tab.id && (
            <motion.div
              layoutId="dataSourceFilter"
              className="absolute inset-0 bg-white/10 rounded-lg"
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            />
          )}
          <span className="relative">{tab.label}</span>
          {tab.count !== undefined && (
            <span
              className={cn(
                'relative px-1.5 py-0.5 rounded text-[10px] font-semibold',
                value === tab.id
                  ? 'bg-white/20 text-white'
                  : 'bg-white/5 text-white/40'
              )}
            >
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// Data Source Summary Card
interface DataSourceSummaryProps {
  source: DataSource
  count: number
  total: number
  trend?: number
  className?: string
}

export function DataSourceSummary({ source, count, total, trend, className }: DataSourceSummaryProps) {
  const sourceConfig = config[source as keyof typeof config] || config.manual
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0
  const Icon = sourceConfig.icon

  return (
    <div
      className={cn(
        'p-4 rounded-xl border backdrop-blur-sm',
        sourceConfig.bgColor,
        sourceConfig.borderColor,
        className
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={cn('p-2 rounded-lg', sourceConfig.bgColor)}>
          <Icon className={cn('w-5 h-5', sourceConfig.textColor)} />
        </div>
        {trend !== undefined && (
          <span
            className={cn(
              'text-xs font-medium',
              trend >= 0 ? 'text-emerald-400' : 'text-red-400'
            )}
          >
            {trend >= 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-white mb-1">{count.toLocaleString()}</p>
      <p className="text-xs text-white/50">
        {sourceConfig.label} Records ({percentage}%)
      </p>
      {/* Progress bar */}
      <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className={cn('h-full rounded-full', sourceConfig.dotColor)}
        />
      </div>
    </div>
  )
}