'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar,
  Clock,
  Users,
  UserCheck,
  UserX,
  QrCode,
  Fingerprint,
  Smartphone,
  ClipboardCheck,
  Download,
  Filter,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Timer,
  MoreHorizontal,
  Search,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import { SourceDot, SourceFilter } from '@/components/shared/SourceBadge';
import { cn, formatDate, formatTime } from '@/lib/utils';

type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused' | 'partial';
type CheckInMethod = 'manual' | 'qr_code' | 'kiosk' | 'badge' | 'mobile' | 'biometric';
type ViewMode = 'daily' | 'session' | 'learner';

interface AttendanceRecord {
  id: string;
  learner_id: string;
  learner_name: string;
  learner_email: string;
  department: string;
  session_id: string;
  session_title: string;
  date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  status: AttendanceStatus;
  check_in_method: CheckInMethod | null;
  duration_minutes: number | null;
  data_source: 'offline' | 'lms';
}

interface SessionSummary {
  id: string;
  title: string;
  course_name: string;
  date: string;
  start_time: string;
  end_time: string;
  venue: string;
  instructor: string;
  total_enrolled: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  data_source: 'offline' | 'lms';
}

// Sample data
const sampleAttendance: AttendanceRecord[] = [
  { id: '1', learner_id: 'L1', learner_name: 'Ahmed Ibrahim Al-Rashid', learner_email: 'ahmed@company.com', department: 'IT', session_id: 'S1', session_title: 'Leadership Excellence - Day 1', date: '2025-01-15', check_in_time: '08:55', check_out_time: '17:05', status: 'present', check_in_method: 'qr_code', duration_minutes: 490, data_source: 'offline' },
  { id: '2', learner_id: 'L2', learner_name: 'Sara Mohamed Al-Zahrani', learner_email: 'sara@company.com', department: 'HR', session_id: 'S1', session_title: 'Leadership Excellence - Day 1', date: '2025-01-15', check_in_time: '09:15', check_out_time: '17:00', status: 'late', check_in_method: 'mobile', duration_minutes: 465, data_source: 'offline' },
  { id: '3', learner_id: 'L3', learner_name: 'Omar Khalid Hassan', learner_email: 'omar@company.com', department: 'Finance', session_id: 'S1', session_title: 'Leadership Excellence - Day 1', date: '2025-01-15', check_in_time: null, check_out_time: null, status: 'absent', check_in_method: null, duration_minutes: null, data_source: 'offline' },
  { id: '4', learner_id: 'L4', learner_name: 'Fatima Abdullah Al-Qasim', learner_email: 'fatima@company.com', department: 'Marketing', session_id: 'S1', session_title: 'Leadership Excellence - Day 1', date: '2025-01-15', check_in_time: '08:50', check_out_time: '17:10', status: 'present', check_in_method: 'biometric', duration_minutes: 500, data_source: 'offline' },
  { id: '5', learner_id: 'L5', learner_name: 'Mohammed Ali Al-Farsi', learner_email: 'mohammed@company.com', department: 'Operations', session_id: 'S1', session_title: 'Leadership Excellence - Day 1', date: '2025-01-15', check_in_time: null, check_out_time: null, status: 'excused', check_in_method: null, duration_minutes: null, data_source: 'offline' },
  { id: '6', learner_id: 'L6', learner_name: 'Noura Salim Al-Otaibi', learner_email: 'noura@company.com', department: 'Sales', session_id: 'S2', session_title: 'Cybersecurity Fundamentals', date: '2025-01-15', check_in_time: '10:00', check_out_time: '14:00', status: 'present', check_in_method: 'qr_code', duration_minutes: 240, data_source: 'lms' },
  { id: '7', learner_id: 'L7', learner_name: 'Khalid Saeed Al-Mutairi', learner_email: 'khalid@company.com', department: 'IT', session_id: 'S2', session_title: 'Cybersecurity Fundamentals', date: '2025-01-15', check_in_time: '10:05', check_out_time: '13:30', status: 'partial', check_in_method: 'mobile', duration_minutes: 205, data_source: 'lms' },
  { id: '8', learner_id: 'L8', learner_name: 'Layla Hassan Al-Shamri', learner_email: 'layla@company.com', department: 'Legal', session_id: 'S2', session_title: 'Cybersecurity Fundamentals', date: '2025-01-15', check_in_time: '10:00', check_out_time: '14:00', status: 'present', check_in_method: 'kiosk', duration_minutes: 240, data_source: 'lms' },
];

const sampleSessions: SessionSummary[] = [
  { id: 'S1', title: 'Leadership Excellence - Day 1', course_name: 'Leadership Excellence Program', date: '2025-01-15', start_time: '09:00', end_time: '17:00', venue: 'Main Training Center - Hall A', instructor: 'Dr. Ahmed Hassan', total_enrolled: 22, present: 18, absent: 2, late: 1, excused: 1, data_source: 'offline' },
  { id: 'S2', title: 'Cybersecurity Fundamentals', course_name: 'Cybersecurity Basics', date: '2025-01-15', start_time: '10:00', end_time: '14:00', venue: 'Virtual - Zoom', instructor: 'Eng. Sara Mohamed', total_enrolled: 35, present: 30, absent: 3, late: 2, excused: 0, data_source: 'lms' },
  { id: 'S3', title: 'Data Analysis Workshop', course_name: 'Advanced Data Analysis', date: '2025-01-15', start_time: '14:00', end_time: '18:00', venue: 'Computer Lab 2', instructor: 'Mohamed Ali', total_enrolled: 15, present: 14, absent: 0, late: 1, excused: 0, data_source: 'offline' },
];

const statusConfig: Record<AttendanceStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  present: { label: 'Present', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: CheckCircle2 },
  absent: { label: 'Absent', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: XCircle },
  late: { label: 'Late', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: Timer },
  excused: { label: 'Excused', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: AlertCircle },
  partial: { label: 'Partial', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', icon: Clock },
};

const methodIcons: Record<CheckInMethod, typeof QrCode> = {
  qr_code: QrCode,
  mobile: Smartphone,
  biometric: Fingerprint,
  kiosk: ClipboardCheck,
  badge: UserCheck,
  manual: ClipboardCheck,
};

export default function AttendancePage() {
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [selectedDate, setSelectedDate] = useState('2025-01-15');
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'offline' | 'lms'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Filter attendance based on view mode and filters
  const filteredAttendance = sampleAttendance.filter(record => {
    if (sourceFilter !== 'all' && record.data_source !== sourceFilter) return false;
    if (searchQuery && !record.learner_name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (viewMode === 'daily' && record.date !== selectedDate) return false;
    if (viewMode === 'session' && selectedSession && record.session_id !== selectedSession) return false;
    return true;
  });

  // Calculate stats
  const stats = {
    total: filteredAttendance.length,
    present: filteredAttendance.filter(r => r.status === 'present').length,
    absent: filteredAttendance.filter(r => r.status === 'absent').length,
    late: filteredAttendance.filter(r => r.status === 'late').length,
    excused: filteredAttendance.filter(r => r.status === 'excused').length,
    partial: filteredAttendance.filter(r => r.status === 'partial').length,
    attendanceRate: filteredAttendance.length > 0 
      ? Math.round((filteredAttendance.filter(r => ['present', 'late', 'partial'].includes(r.status)).length / filteredAttendance.length) * 100)
      : 0,
  };

  const sourceCounts = {
    all: sampleAttendance.length,
    offline: sampleAttendance.filter(r => r.data_source === 'offline').length,
    lms: sampleAttendance.filter(r => r.data_source === 'lms').length,
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <Header title="Attendance" subtitle="Track and manage training attendance" />

      <div className="p-6 space-y-6">
        {/* View Mode Tabs & Filters */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* View Mode Toggle */}
            <div className="inline-flex items-center p-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
              {[
                { key: 'daily', label: 'Daily View', icon: Calendar },
                { key: 'session', label: 'By Session', icon: Users },
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setViewMode(key as ViewMode)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                    viewMode === key
                      ? 'bg-entlaqa-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>

            {/* Date Picker (for daily view) */}
            {viewMode === 'daily' && (
              <div className="flex items-center gap-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-1">
                <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
                  <ChevronLeft className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                </button>
                <div className="px-3 py-1.5 text-sm font-medium text-slate-900 dark:text-white">
                  {formatDate(selectedDate)}
                </div>
                <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
                  <ChevronRight className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <SourceFilter value={sourceFilter} onChange={setSourceFilter} counts={sourceCounts} />
            <button className="btn-ghost text-sm">
              <Download className="w-4 h-4" />
              Export
            </button>
            <button className="btn-primary text-sm">
              <QrCode className="w-4 h-4" />
              Open Check-In
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
          >
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              <span className="text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Total</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span className="text-2xl font-bold text-emerald-600">{stats.present}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Present</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
          >
            <div className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-600" />
              <span className="text-2xl font-bold text-red-600">{stats.absent}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Absent</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
          >
            <div className="flex items-center gap-2">
              <Timer className="w-5 h-5 text-amber-600" />
              <span className="text-2xl font-bold text-amber-600">{stats.late}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Late</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-blue-600" />
              <span className="text-2xl font-bold text-blue-600">{stats.excused}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Excused</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
          >
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-purple-600" />
              <span className="text-2xl font-bold text-purple-600">{stats.partial}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Partial</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-gradient-to-br from-entlaqa-500 to-entlaqa-600 rounded-xl p-4 text-white"
          >
            <div className="text-2xl font-bold">{stats.attendanceRate}%</div>
            <p className="text-sm text-white/80 mt-1">Attendance Rate</p>
          </motion.div>
        </div>

        {/* Session Cards (for session view) or Attendance Table */}
        {viewMode === 'session' && !selectedSession ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {sampleSessions
              .filter(s => sourceFilter === 'all' || s.data_source === sourceFilter)
              .map((session) => (
                <motion.div
                  key={session.id}
                  whileHover={{ scale: 1.02 }}
                  onClick={() => setSelectedSession(session.id)}
                  className={cn(
                    'bg-white dark:bg-slate-800 rounded-xl border-l-4 border border-slate-200 dark:border-slate-700 p-5 cursor-pointer hover:shadow-lg transition-all',
                    session.data_source === 'offline' ? 'border-l-source-offline' : 'border-l-source-lms'
                  )}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-slate-900 dark:text-white">{session.title}</h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400">{session.course_name}</p>
                    </div>
                    <SourceDot source={session.data_source} />
                  </div>

                  <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400 mb-4">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      {formatTime(session.start_time)} - {formatTime(session.end_time)}
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      {session.instructor}
                    </div>
                  </div>

                  {/* Attendance Bar */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Attendance</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {session.present + session.late}/{session.total_enrolled}
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden flex">
                      <div 
                        className="h-full bg-emerald-500" 
                        style={{ width: `${(session.present / session.total_enrolled) * 100}%` }} 
                      />
                      <div 
                        className="h-full bg-amber-500" 
                        style={{ width: `${(session.late / session.total_enrolled) * 100}%` }} 
                      />
                      <div 
                        className="h-full bg-red-500" 
                        style={{ width: `${(session.absent / session.total_enrolled) * 100}%` }} 
                      />
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        {session.present} Present
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        {session.late} Late
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-red-500" />
                        {session.absent} Absent
                      </span>
                    </div>
                  </div>
                </motion.div>
              ))}
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
          >
            {/* Table Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {selectedSession && (
                    <button
                      onClick={() => setSelectedSession(null)}
                      className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                  )}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search learners..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm w-64 focus:outline-none focus:ring-2 focus:ring-entlaqa-500/20"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn-ghost text-sm">
                    <ClipboardCheck className="w-4 h-4" />
                    Mark All Present
                  </button>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 dark:bg-slate-900/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Learner</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Session</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Check-In</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Check-Out</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Duration</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Method</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase w-20">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  <AnimatePresence mode="popLayout">
                    {filteredAttendance.map((record, index) => {
                      const StatusIcon = statusConfig[record.status].icon;
                      const MethodIcon = record.check_in_method ? methodIcons[record.check_in_method] : null;
                      
                      return (
                        <motion.tr
                          key={record.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2, delay: index * 0.02 }}
                          className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
                        >
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-entlaqa-gradient flex items-center justify-center text-white text-sm font-medium">
                                {record.learner_name.split(' ').slice(0, 2).map(n => n[0]).join('')}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-slate-900 dark:text-white text-sm">
                                    {record.learner_name}
                                  </span>
                                  <SourceDot source={record.data_source} size="sm" />
                                </div>
                                <p className="text-xs text-slate-500">{record.department}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <span className="text-sm text-slate-700 dark:text-slate-300">
                              {record.session_title}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <span className="text-sm text-slate-700 dark:text-slate-300">
                              {record.check_in_time ? formatTime(record.check_in_time) : '—'}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <span className="text-sm text-slate-700 dark:text-slate-300">
                              {record.check_out_time ? formatTime(record.check_out_time) : '—'}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <span className="text-sm text-slate-700 dark:text-slate-300">
                              {record.duration_minutes ? `${Math.floor(record.duration_minutes / 60)}h ${record.duration_minutes % 60}m` : '—'}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            {MethodIcon && (
                              <div className="flex items-center gap-1.5">
                                <MethodIcon className="w-4 h-4 text-slate-400" />
                                <span className="text-xs text-slate-600 dark:text-slate-400 capitalize">
                                  {record.check_in_method?.replace('_', ' ')}
                                </span>
                              </div>
                            )}
                            {!MethodIcon && <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-4 py-4">
                            <span className={cn(
                              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
                              statusConfig[record.status].color
                            )}>
                              <StatusIcon className="w-3 h-3" />
                              {statusConfig[record.status].label}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <button className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
                              <MoreHorizontal className="w-4 h-4 text-slate-500" />
                            </button>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>

            {filteredAttendance.length === 0 && (
              <div className="py-12 text-center">
                <UserX className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                <p className="text-slate-500 dark:text-slate-400 font-medium">No attendance records found</p>
                <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Try adjusting your filters</p>
              </div>
            )}
          </motion.div>
        )}

        {/* Check-In Methods Legend */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
        >
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Supported Check-In Methods</h3>
          <div className="flex flex-wrap gap-4">
            {Object.entries(methodIcons).map(([method, Icon]) => (
              <div key={method} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                  <Icon className="w-4 h-4" />
                </div>
                <span className="capitalize">{method.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
