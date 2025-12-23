'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  GraduationCap,
  Calendar,
  Award,
  Clock,
  MapPin,
  UserCircle,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import Header from '@/components/layout/Header';
import StatCard, { ProgressStat } from '@/components/dashboard/StatCard';
import { SourceBadge, SourceDot, SourceFilter } from '@/components/shared/SourceBadge';
import { cn, formatDate } from '@/lib/utils';

const enrollmentData = [
  { month: 'Jan', offline: 45, lms: 32 },
  { month: 'Feb', offline: 52, lms: 38 },
  { month: 'Mar', offline: 48, lms: 45 },
  { month: 'Apr', offline: 70, lms: 52 },
  { month: 'May', offline: 65, lms: 58 },
  { month: 'Jun', offline: 85, lms: 65 },
];

const sourceDistribution = [
  { name: 'Offline', value: 365, color: '#22c55e' },
  { name: 'LMS', value: 290, color: '#a855f7' },
];

const upcomingSessions = [
  { id: 1, title: 'Leadership Excellence Program', course: 'Leadership Skills', date: '2025-01-15', time: '09:00', venue: 'Main Training Center - Hall A', instructor: 'Dr. Ahmed Hassan', enrolled: 18, capacity: 25, source: 'offline' as const },
  { id: 2, title: 'Cybersecurity Fundamentals', course: 'Cybersecurity Basics', date: '2025-01-16', time: '10:00', venue: 'Virtual - Zoom', instructor: 'Eng. Sara Mohamed', enrolled: 32, capacity: 40, source: 'lms' as const },
  { id: 3, title: 'Data Analysis with Excel', course: 'Data Analysis', date: '2025-01-17', time: '14:00', venue: 'Computer Lab 2', instructor: 'Mohamed Ali', enrolled: 12, capacity: 15, source: 'offline' as const },
];

const recentActivities = [
  { id: 1, action: 'New enrollment', description: 'Ahmed Ibrahim enrolled in Leadership Program', time: '5 minutes ago', source: 'offline' as const, icon: Users },
  { id: 2, action: 'Certificate issued', description: '15 certificates generated for Data Analysis', time: '1 hour ago', source: 'offline' as const, icon: Award },
  { id: 3, action: 'LMS sync completed', description: '45 learner records synchronized from Jadarat', time: '2 hours ago', source: 'lms' as const, icon: Activity },
  { id: 4, action: 'Session completed', description: 'Project Management Basics - 22 attendees', time: '3 hours ago', source: 'lms' as const, icon: CheckCircle2 },
];

export default function DashboardPage() {
  const [sourceFilter, setSourceFilter] = useState<'all' | 'offline' | 'lms'>('all');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <Header title="Dashboard" subtitle="Welcome back! Here's what's happening today." />

      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <SourceFilter value={sourceFilter} onChange={setSourceFilter} counts={{ all: 655, offline: 365, lms: 290 }} />
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Clock className="w-4 h-4" />
            Last updated: {formatDate(new Date())}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard title="Total Learners" value="1,284" change={12} icon={Users} iconColor="text-blue-600" iconBgColor="bg-blue-100 dark:bg-blue-950/50" breakdown={{ offline: 756, lms: 528 }} delay={0} />
          <StatCard title="Active Courses" value="48" change={8} icon={GraduationCap} iconColor="text-emerald-600" iconBgColor="bg-emerald-100 dark:bg-emerald-950/50" breakdown={{ offline: 32, lms: 16 }} delay={0.1} />
          <StatCard title="Sessions This Month" value="156" change={-3} icon={Calendar} iconColor="text-amber-600" iconBgColor="bg-amber-100 dark:bg-amber-950/50" breakdown={{ offline: 98, lms: 58 }} delay={0.2} />
          <StatCard title="Certificates Issued" value="892" change={24} icon={Award} iconColor="text-purple-600" iconBgColor="bg-purple-100 dark:bg-purple-950/50" breakdown={{ offline: 567, lms: 325 }} delay={0.3} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.4 }} className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Enrollment Trends</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">Monthly enrollments by data source</p>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-source-offline" /><span className="text-slate-600 dark:text-slate-400">Offline</span></div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-source-lms" /><span className="text-slate-600 dark:text-slate-400">LMS</span></div>
              </div>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={enrollmentData}>
                  <defs>
                    <linearGradient id="offlineGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} /><stop offset="95%" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
                    <linearGradient id="lmsGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} /><stop offset="95%" stopColor="#a855f7" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Area type="monotone" dataKey="offline" stroke="#22c55e" strokeWidth={2} fill="url(#offlineGradient)" />
                  <Area type="monotone" dataKey="lms" stroke="#a855f7" strokeWidth={2} fill="url(#lmsGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.5 }} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Data Source Distribution</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Total records by source</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={sourceDistribution} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={5} dataKey="value">{sourceDistribution.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.color} />))}</Pie><Tooltip /></PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3 mt-4">
              {sourceDistribution.map((item) => (<div key={item.name} className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} /><span className="text-sm text-slate-600 dark:text-slate-400">{item.name}</span></div><span className="text-sm font-semibold text-slate-900 dark:text-white">{item.value.toLocaleString()}</span></div>))}
            </div>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.6 }} className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
            <div className="flex items-center justify-between mb-6">
              <div><h3 className="text-lg font-semibold text-slate-900 dark:text-white">Upcoming Sessions</h3><p className="text-sm text-slate-500 dark:text-slate-400">Next 7 days</p></div>
              <a href="/dashboard/sessions" className="text-sm font-medium text-entlaqa-600 hover:text-entlaqa-700">View all →</a>
            </div>
            <div className="space-y-4">
              {upcomingSessions.map((session) => (
                <div key={session.id} className={cn('p-4 rounded-xl border-l-4 bg-slate-50 dark:bg-slate-700/30', session.source === 'offline' ? 'border-l-source-offline' : 'border-l-source-lms')}>
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2"><h4 className="font-medium text-slate-900 dark:text-white">{session.title}</h4><SourceBadge source={session.source} size="sm" showLabel={false} /></div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">{session.course}</p>
                      <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{formatDate(session.date)} at {session.time}</span>
                        <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{session.venue}</span>
                        <span className="flex items-center gap-1"><UserCircle className="w-3.5 h-3.5" />{session.instructor}</span>
                      </div>
                    </div>
                    <div className="text-right"><p className="text-lg font-semibold text-slate-900 dark:text-white">{session.enrolled}/{session.capacity}</p><p className="text-xs text-slate-500">enrolled</p></div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.7 }} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Recent Activity</h3>
            <div className="space-y-4">
              {recentActivities.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className={cn('p-2 rounded-lg', activity.source === 'offline' ? 'bg-source-offline-light' : 'bg-source-lms-light')}>
                    <activity.icon className={cn('w-4 h-4', activity.source === 'offline' ? 'text-source-offline-dark' : 'text-source-lms-dark')} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{activity.action}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{activity.description}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.8 }} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Compliance Status</h3>
            <ProgressStat label="Overall Compliance" value={892} max={1200} breakdown={{ offline: 534, lms: 358 }} />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.9 }} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Venue Utilization</h3>
            <div className="flex items-center justify-center">
              <div className="relative">
                <svg className="w-24 h-24 transform -rotate-90"><circle cx="48" cy="48" r="40" className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="8" fill="none" /><circle cx="48" cy="48" r="40" className="stroke-entlaqa-500" strokeWidth="8" fill="none" strokeDasharray={`${(72 / 100) * 251.2} 251.2`} strokeLinecap="round" /></svg>
                <div className="absolute inset-0 flex items-center justify-center"><span className="text-2xl font-bold text-slate-900 dark:text-white">72%</span></div>
              </div>
            </div>
            <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-2">18 of 25 rooms in use</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 1 }} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Active Instructors</h3>
            <div className="flex items-center justify-between">
              <div><p className="text-3xl font-bold text-slate-900 dark:text-white">24</p><p className="text-sm text-slate-500 dark:text-slate-400">12 internal, 12 external</p></div>
              <div className="flex -space-x-2">
                {[1, 2, 3, 4].map((i) => (<div key={i} className="w-10 h-10 rounded-full bg-entlaqa-gradient border-2 border-white dark:border-slate-800 flex items-center justify-center text-white text-sm font-medium">{String.fromCharCode(64 + i)}</div>))}
                <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 border-2 border-white dark:border-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 text-sm font-medium">+20</div>
              </div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 1.1 }} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Monthly Budget</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between"><span className="text-sm text-slate-500">Spent</span><span className="text-lg font-bold text-slate-900 dark:text-white">SAR 145,000</span></div>
              <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden"><div className="h-full bg-entlaqa-gradient" style={{ width: '72%' }} /></div>
              <div className="flex items-center justify-between text-xs text-slate-500"><span>SAR 55,000 remaining</span><span>Budget: SAR 200,000</span></div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
