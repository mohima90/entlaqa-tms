'use client';

import { useState } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Bell,
  Plus,
  ChevronDown,
  Filter,
  Calendar,
  Users,
  GraduationCap,
  LogOut,
  User,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export default function Header({ title, subtitle }: HeaderProps) {
  const [showSearch, setShowSearch] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const notifications = [
    {
      id: 1,
      title: 'New enrollment request',
      message: 'Ahmed Hassan requested to join "Leadership Skills"',
      time: '5 min ago',
      read: false,
      source: 'offline' as const,
    },
    {
      id: 2,
      title: 'Session starting soon',
      message: 'Cybersecurity Basics starts in 1 hour',
      time: '30 min ago',
      read: false,
      source: 'lms' as const,
    },
    {
      id: 3,
      title: 'Certificate issued',
      message: '15 certificates generated for Data Analysis course',
      time: '2 hours ago',
      read: true,
      source: 'offline' as const,
    },
  ];

  const quickActions = [
    { name: 'New Session', icon: Calendar, href: '/dashboard/sessions/new' },
    { name: 'Add Learner', icon: Users, href: '/dashboard/learners/new' },
    { name: 'New Course', icon: GraduationCap, href: '/dashboard/courses/new' },
  ];

  return (
    <header className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between px-6 py-4">
        {/* Left: Title */}
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {subtitle}
            </p>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <AnimatePresence>
              {showSearch ? (
                <motion.div
                  initial={{ width: 40, opacity: 0 }}
                  animate={{ width: 300, opacity: 1 }}
                  exit={{ width: 40, opacity: 0 }}
                  className="relative"
                >
                  <input
                    type="text"
                    placeholder="Search courses, sessions, learners..."
                    className="w-full pl-10 pr-4 py-2 bg-slate-100 dark:bg-slate-800 border-0 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-entlaqa-500/20"
                    autoFocus
                    onBlur={() => setShowSearch(false)}
                  />
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                </motion.div>
              ) : (
                <button
                  onClick={() => setShowSearch(true)}
                  className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  <Search className="w-5 h-5" />
                </button>
              )}
            </AnimatePresence>
          </div>

          {/* Quick Actions */}
          <div className="relative">
            <button
              onClick={() => setShowQuickActions(!showQuickActions)}
              className="flex items-center gap-2 px-4 py-2.5 bg-entlaqa-gradient text-white font-medium rounded-xl hover:shadow-lg hover:shadow-entlaqa-500/25 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span className="text-sm">Quick Add</span>
              <ChevronDown className={cn('w-4 h-4 transition-transform', showQuickActions && 'rotate-180')} />
            </button>

            <AnimatePresence>
              {showQuickActions && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-800 rounded-xl shadow-glass-lg border border-slate-200 dark:border-slate-700 overflow-hidden"
                >
                  {quickActions.map((action) => (
                    <a
                      key={action.name}
                      href={action.href}
                      className="flex items-center gap-3 px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                    >
                      <action.icon className="w-4 h-4 text-slate-500" />
                      {action.name}
                    </a>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
            </button>

            <AnimatePresence>
              {showNotifications && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-800 rounded-xl shadow-glass-lg border border-slate-200 dark:border-slate-700 overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="font-semibold text-slate-900 dark:text-white">Notifications</h3>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.map((notification) => (
                      <div
                        key={notification.id}
                        className={cn(
                          'px-4 py-3 border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors',
                          !notification.read && 'bg-entlaqa-50/50 dark:bg-entlaqa-950/20'
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={cn(
                              'w-2 h-2 mt-2 rounded-full flex-shrink-0',
                              notification.source === 'offline' ? 'bg-source-offline' : 'bg-source-lms'
                            )}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-white">
                              {notification.title}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              {notification.message}
                            </p>
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                              {notification.time}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <a
                    href="/dashboard/notifications"
                    className="block px-4 py-3 text-center text-sm text-entlaqa-600 dark:text-entlaqa-400 hover:bg-slate-50 dark:hover:bg-slate-700/30 font-medium transition-colors"
                  >
                    View All Notifications
                  </a>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* User Menu */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-3 p-1.5 pr-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <div className="w-9 h-9 rounded-lg bg-entlaqa-gradient flex items-center justify-center text-white font-semibold text-sm">
                MA
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium text-slate-900 dark:text-white">Mohamed A.</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Admin</p>
              </div>
              <ChevronDown className={cn('w-4 h-4 text-slate-400 transition-transform', showUserMenu && 'rotate-180')} />
            </button>

            <AnimatePresence>
              {showUserMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-800 rounded-xl shadow-glass-lg border border-slate-200 dark:border-slate-700 overflow-hidden"
                >
                  <a
                    href="/dashboard/profile"
                    className="flex items-center gap-3 px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                  >
                    <User className="w-4 h-4" />
                    My Profile
                  </a>
                  <a
                    href="/dashboard/settings"
                    className="flex items-center gap-3 px-4 py-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </a>
                  <hr className="border-slate-200 dark:border-slate-700" />
                  <button className="flex items-center gap-3 w-full px-4 py-3 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors">
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
}
