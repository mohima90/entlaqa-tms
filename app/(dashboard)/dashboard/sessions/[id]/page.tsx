'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  Clock,
  MapPin,
  Users,
  UserCircle,
  Edit,
  Trash2,
  Copy,
  Download,
  Mail,
  QrCode,
  CheckCircle,
  XCircle,
  AlertCircle,
  Plus,
  FileText,
  Video,
  Link as LinkIcon,
  Send,
  UserPlus,
  UserMinus,
  ClipboardCheck,
  Award,
  MoreHorizontal,
  Phone,
  Building2,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import { SourceBadge, SourceDot } from '@/components/shared/SourceBadge';
import { cn, formatDate, formatTime, formatCurrency } from '@/lib/utils';

type TabType = 'overview' | 'enrollments' | 'attendance' | 'materials' | 'feedback';

interface Enrollment {
  id: string;
  learner_name: string;
  learner_email: string;
  department: string;
  enrolled_at: string;
  status: 'enrolled' | 'confirmed' | 'waitlist' | 'cancelled' | 'completed';
  attendance_status: 'pending' | 'present' | 'absent' | 'late' | 'excused';
  data_source: 'offline' | 'lms';
}

const sessionData = {
  id: 'S1',
  title: 'Leadership Excellence Program - Batch 12',
  course_name: 'Leadership Excellence Program',
  course_code: 'LEAD-101',
  description: 'A comprehensive leadership development program designed for mid-to-senior level managers. This three-day intensive program covers strategic thinking, team leadership, change management, and executive presence.',
  start_date: '2025-01-15',
  end_date: '2025-01-17',
  start_time: '09:00',
  end_time: '17:00',
  venue: 'Main Training Center',
  room: 'Hall A',
  venue_address: 'King Fahd Road, Al Olaya District, Riyadh',
  instructor: {
    name: 'Dr. Ahmed Hassan Al-Rashid',
    email: 'ahmed.hassan@trainer.com',
    phone: '+966 50 111 2222',
    rating: 4.9,
  },
  delivery_mode: 'ilt',
  capacity: 25,
  enrolled_count: 22,
  waitlist_count: 3,
  attendance_rate: 91,
  status: 'confirmed',
  cost_per_learner: 2500,
  total_cost: 55000,
  created_by: 'Admin User',
  created_at: '2024-12-01',
  data_source: 'offline' as const,
  prerequisites: ['Minimum 3 years management experience', 'Completed Basic Leadership course'],
  learning_outcomes: [
    'Develop strategic leadership capabilities',
    'Master effective team communication',
    'Lead organizational change initiatives',
    'Build executive presence and influence',
  ],
};

const enrollments: Enrollment[] = [
  { id: '1', learner_name: 'Ahmed Ibrahim Al-Rashid', learner_email: 'ahmed@company.com', department: 'IT', enrolled_at: '2024-12-05', status: 'confirmed', attendance_status: 'present', data_source: 'offline' },
  { id: '2', learner_name: 'Sara Mohamed Al-Zahrani', learner_email: 'sara@company.com', department: 'HR', enrolled_at: '2024-12-06', status: 'confirmed', attendance_status: 'late', data_source: 'offline' },
  { id: '3', learner_name: 'Omar Khalid Hassan', learner_email: 'omar@company.com', department: 'Finance', enrolled_at: '2024-12-07', status: 'confirmed', attendance_status: 'absent', data_source: 'offline' },
  { id: '4', learner_name: 'Fatima Abdullah Al-Qasim', learner_email: 'fatima@company.com', department: 'Marketing', enrolled_at: '2024-12-08', status: 'confirmed', attendance_status: 'present', data_source: 'lms' },
  { id: '5', learner_name: 'Mohammed Ali Al-Farsi', learner_email: 'mohammed@company.com', department: 'Operations', enrolled_at: '2024-12-09', status: 'confirmed', attendance_status: 'excused', data_source: 'offline' },
  { id: '6', learner_name: 'Noura Salim Al-Otaibi', learner_email: 'noura@company.com', department: 'Sales', enrolled_at: '2024-12-15', status: 'waitlist', attendance_status: 'pending', data_source: 'lms' },
  { id: '7', learner_name: 'Khalid Saeed Al-Mutairi', learner_email: 'khalid@company.com', department: 'IT', enrolled_at: '2024-12-16', status: 'waitlist', attendance_status: 'pending', data_source: 'offline' },
  { id: '8', learner_name: 'Layla Hassan Al-Shamri', learner_email: 'layla@company.com', department: 'Legal', enrolled_at: '2024-12-10', status: 'cancelled', attendance_status: 'pending', data_source: 'lms' },
];

const materials = [
  { id: '1', name: 'Leadership Excellence Workbook.pdf', type: 'pdf', size: '2.4 MB', uploaded_at: '2024-12-10' },
  { id: '2', name: 'Case Studies Collection.pdf', type: 'pdf', size: '5.1 MB', uploaded_at: '2024-12-10' },
  { id: '3', name: 'Self-Assessment Tool.xlsx', type: 'excel', size: '856 KB', uploaded_at: '2024-12-12' },
  { id: '4', name: 'Pre-session Video.mp4', type: 'video', size: '45 MB', uploaded_at: '2024-12-14' },
];

const statusConfig = {
  enrolled: { label: 'Enrolled', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  confirmed: { label: 'Confirmed', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  waitlist: { label: 'Waitlist', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  completed: { label: 'Completed', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
};

const attendanceConfig = {
  pending: { label: 'Pending', color: 'text-slate-500', icon: Clock },
  present: { label: 'Present', color: 'text-emerald-600', icon: CheckCircle },
  absent: { label: 'Absent', color: 'text-red-600', icon: XCircle },
  late: { label: 'Late', color: 'text-amber-600', icon: AlertCircle },
  excused: { label: 'Excused', color: 'text-blue-600', icon: AlertCircle },
};

export default function SessionDetailPage() {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [selectedEnrollments, setSelectedEnrollments] = useState<string[]>([]);

  const tabs = [
    { key: 'overview', label: 'Overview', icon: FileText },
    { key: 'enrollments', label: `Enrollments (${sessionData.enrolled_count})`, icon: Users },
    { key: 'attendance', label: 'Attendance', icon: ClipboardCheck },
    { key: 'materials', label: `Materials (${materials.length})`, icon: FileText },
    { key: 'feedback', label: 'Feedback', icon: Award },
  ];

  const toggleEnrollmentSelection = (id: string) => {
    setSelectedEnrollments(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const selectAllEnrollments = () => {
    if (selectedEnrollments.length === enrollments.length) {
      setSelectedEnrollments([]);
    } else {
      setSelectedEnrollments(enrollments.map(e => e.id));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Custom Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="px-6 py-4">
          <div className="flex items-center gap-4 mb-4">
            <Link href="/dashboard/sessions" className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5 text-slate-600 dark:text-slate-400" />
            </Link>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-display font-bold text-slate-900 dark:text-white">
                  {sessionData.title}
                </h1>
                <SourceBadge source={sessionData.data_source} />
              </div>
              <p className="text-sm text-slate-500 mt-1">
                {sessionData.course_code} • {sessionData.course_name}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-ghost text-sm">
                <Copy className="w-4 h-4" />
                Duplicate
              </button>
              <button className="btn-ghost text-sm">
                <Edit className="w-4 h-4" />
                Edit
              </button>
              <button className="btn-primary text-sm">
                <QrCode className="w-4 h-4" />
                Check-In
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 -mb-px">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key as TabType)}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                  activeTab === key
                    ? 'border-entlaqa-600 text-entlaqa-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-6">
        <AnimatePresence mode="wait">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-6"
            >
              {/* Main Info */}
              <div className="lg:col-span-2 space-y-6">
                {/* Session Details Card */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Session Details</h2>
                  <p className="text-slate-600 dark:text-slate-400 mb-6">{sessionData.description}</p>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div>
                      <p className="text-sm text-slate-500 mb-1">Date</p>
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-slate-400" />
                        <span className="font-medium text-slate-900 dark:text-white">
                          {formatDate(sessionData.start_date)}
                          {sessionData.start_date !== sessionData.end_date && ` - ${formatDate(sessionData.end_date)}`}
                        </span>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 mb-1">Time</p>
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-slate-400" />
                        <span className="font-medium text-slate-900 dark:text-white">
                          {formatTime(sessionData.start_time)} - {formatTime(sessionData.end_time)}
                        </span>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 mb-1">Delivery Mode</p>
                      <div className="flex items-center gap-2">
                        {sessionData.delivery_mode === 'vilt' ? (
                          <Video className="w-4 h-4 text-purple-500" />
                        ) : (
                          <Building2 className="w-4 h-4 text-blue-500" />
                        )}
                        <span className="font-medium text-slate-900 dark:text-white capitalize">
                          {sessionData.delivery_mode === 'ilt' ? 'In-Person' : sessionData.delivery_mode === 'vilt' ? 'Virtual' : 'Blended'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 mb-1">Capacity</p>
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-slate-400" />
                        <span className="font-medium text-slate-900 dark:text-white">
                          {sessionData.enrolled_count}/{sessionData.capacity}
                        </span>
                        {sessionData.waitlist_count > 0 && (
                          <span className="text-xs text-amber-600">+{sessionData.waitlist_count} waitlist</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Venue Card */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Venue</h2>
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                      <MapPin className="w-6 h-6 text-slate-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">{sessionData.venue}</p>
                      <p className="text-sm text-slate-500">{sessionData.room}</p>
                      <p className="text-sm text-slate-500 mt-1">{sessionData.venue_address}</p>
                      <button className="text-sm text-entlaqa-600 hover:text-entlaqa-700 mt-2 flex items-center gap-1">
                        <LinkIcon className="w-4 h-4" />
                        View on map
                      </button>
                    </div>
                  </div>
                </div>

                {/* Learning Outcomes */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Learning Outcomes</h2>
                  <ul className="space-y-3">
                    {sessionData.learning_outcomes.map((outcome, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span className="text-slate-700 dark:text-slate-300">{outcome}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                {/* Quick Stats */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Quick Stats</h2>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Enrollment Rate</span>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {Math.round((sessionData.enrolled_count / sessionData.capacity) * 100)}%
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-entlaqa-500 rounded-full" style={{ width: `${(sessionData.enrolled_count / sessionData.capacity) * 100}%` }} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Attendance Rate</span>
                      <span className="font-semibold text-emerald-600">{sessionData.attendance_rate}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Cost per Learner</span>
                      <span className="font-semibold text-slate-900 dark:text-white">{formatCurrency(sessionData.cost_per_learner)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Total Cost</span>
                      <span className="font-semibold text-slate-900 dark:text-white">{formatCurrency(sessionData.total_cost)}</span>
                    </div>
                  </div>
                </div>

                {/* Instructor Card */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Instructor</h2>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-14 h-14 rounded-full bg-entlaqa-gradient flex items-center justify-center text-white font-bold text-lg">
                      {sessionData.instructor.name.split(' ').slice(0, 2).map(n => n[0]).join('')}
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">{sessionData.instructor.name}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-amber-500">★</span>
                        <span className="text-sm text-slate-600 dark:text-slate-400">{sessionData.instructor.rating}</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <a href={`mailto:${sessionData.instructor.email}`} className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-entlaqa-600">
                      <Mail className="w-4 h-4" />
                      {sessionData.instructor.email}
                    </a>
                    <a href={`tel:${sessionData.instructor.phone}`} className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-entlaqa-600">
                      <Phone className="w-4 h-4" />
                      {sessionData.instructor.phone}
                    </a>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Quick Actions</h2>
                  <div className="space-y-2">
                    <button className="w-full btn-ghost justify-start">
                      <Mail className="w-4 h-4" />
                      Email All Learners
                    </button>
                    <button className="w-full btn-ghost justify-start">
                      <Download className="w-4 h-4" />
                      Export Roster
                    </button>
                    <button className="w-full btn-ghost justify-start">
                      <Award className="w-4 h-4" />
                      Issue Certificates
                    </button>
                    <button className="w-full btn-ghost justify-start text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
                      <XCircle className="w-4 h-4" />
                      Cancel Session
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Enrollments Tab */}
          {activeTab === 'enrollments' && (
            <motion.div
              key="enrollments"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                {/* Toolbar */}
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedEnrollments.length === enrollments.length}
                        onChange={selectAllEnrollments}
                        className="rounded border-slate-300 text-entlaqa-600 focus:ring-entlaqa-500"
                      />
                      <span className="text-sm text-slate-600 dark:text-slate-400">
                        {selectedEnrollments.length > 0 ? `${selectedEnrollments.length} selected` : 'Select all'}
                      </span>
                    </label>
                    {selectedEnrollments.length > 0 && (
                      <div className="flex items-center gap-2">
                        <button className="btn-ghost text-sm">
                          <Mail className="w-4 h-4" />
                          Email
                        </button>
                        <button className="btn-ghost text-sm text-red-600">
                          <UserMinus className="w-4 h-4" />
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                  <button className="btn-primary text-sm">
                    <UserPlus className="w-4 h-4" />
                    Add Learner
                  </button>
                </div>

                {/* Table */}
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-900/50">
                    <tr>
                      <th className="w-12 px-4 py-3"></th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Learner</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Department</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Enrolled</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Attendance</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase w-20">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {enrollments.map((enrollment) => {
                      const AttendanceIcon = attendanceConfig[enrollment.attendance_status].icon;
                      return (
                        <tr key={enrollment.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                          <td className="px-4 py-4">
                            <input
                              type="checkbox"
                              checked={selectedEnrollments.includes(enrollment.id)}
                              onChange={() => toggleEnrollmentSelection(enrollment.id)}
                              className="rounded border-slate-300 text-entlaqa-600 focus:ring-entlaqa-500"
                            />
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-entlaqa-gradient flex items-center justify-center text-white text-sm font-medium">
                                {enrollment.learner_name.split(' ').slice(0, 2).map(n => n[0]).join('')}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-slate-900 dark:text-white text-sm">{enrollment.learner_name}</span>
                                  <SourceDot source={enrollment.data_source} size="sm" />
                                </div>
                                <p className="text-xs text-slate-500">{enrollment.learner_email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-700 dark:text-slate-300">{enrollment.department}</td>
                          <td className="px-4 py-4 text-sm text-slate-700 dark:text-slate-300">{formatDate(enrollment.enrolled_at)}</td>
                          <td className="px-4 py-4">
                            <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium', statusConfig[enrollment.status].color)}>
                              {statusConfig[enrollment.status].label}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <span className={cn('flex items-center gap-1.5 text-sm', attendanceConfig[enrollment.attendance_status].color)}>
                              <AttendanceIcon className="w-4 h-4" />
                              {attendanceConfig[enrollment.attendance_status].label}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <button className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
                              <MoreHorizontal className="w-4 h-4 text-slate-500" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* Materials Tab */}
          {activeTab === 'materials' && (
            <motion.div
              key="materials"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Training Materials</h2>
                  <button className="btn-primary text-sm">
                    <Plus className="w-4 h-4" />
                    Upload Material
                  </button>
                </div>
                <div className="space-y-3">
                  {materials.map((material) => (
                    <div key={material.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700/30 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          'w-10 h-10 rounded-lg flex items-center justify-center',
                          material.type === 'pdf' ? 'bg-red-100 text-red-600' :
                          material.type === 'excel' ? 'bg-emerald-100 text-emerald-600' :
                          'bg-purple-100 text-purple-600'
                        )}>
                          <FileText className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-medium text-slate-900 dark:text-white">{material.name}</p>
                          <p className="text-sm text-slate-500">{material.size} • Uploaded {formatDate(material.uploaded_at)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button className="btn-ghost text-sm">
                          <Download className="w-4 h-4" />
                        </button>
                        <button className="btn-ghost text-sm text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* Attendance Tab */}
          {activeTab === 'attendance' && (
            <motion.div
              key="attendance"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6"
            >
              <div className="text-center py-12">
                <ClipboardCheck className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Take Attendance</h3>
                <p className="text-slate-500 mb-6">Open the attendance check-in page to mark learner attendance</p>
                <button className="btn-primary">
                  <QrCode className="w-4 h-4" />
                  Open Check-In
                </button>
              </div>
            </motion.div>
          )}

          {/* Feedback Tab */}
          {activeTab === 'feedback' && (
            <motion.div
              key="feedback"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6"
            >
              <div className="text-center py-12">
                <Award className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">No Feedback Yet</h3>
                <p className="text-slate-500 mb-6">Feedback will be available after the session is completed</p>
                <button className="btn-primary">
                  <Send className="w-4 h-4" />
                  Send Feedback Survey
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
