'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  Download,
  Calendar,
  Clock,
  MapPin,
  Users,
  UserCircle,
  Eye,
  Edit,
  Trash2,
  Copy,
  Video,
  CheckCircle,
  AlertCircle,
  XCircle,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import DataTable, { Column } from '@/components/ui/DataTable';
import { SourceBadge, SourceDot } from '@/components/shared/SourceBadge';
import { cn, formatDate, formatTime } from '@/lib/utils';

interface Session {
  id: string;
  title: string;
  course_name: string;
  course_code: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  venue: string;
  room: string;
  instructor: string;
  delivery_mode: 'ilt' | 'vilt' | 'blended';
  capacity: number;
  enrolled_count: number;
  waitlist_count: number;
  status: 'draft' | 'scheduled' | 'open' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  data_source: 'offline' | 'lms';
}

const sampleSessions: Session[] = [
  {
    id: '1',
    title: 'Leadership Excellence - Batch 12',
    course_name: 'Leadership Excellence Program',
    course_code: 'LEAD-101',
    start_date: '2025-01-15',
    end_date: '2025-01-17',
    start_time: '09:00',
    end_time: '17:00',
    venue: 'Main Training Center',
    room: 'Hall A',
    instructor: 'Dr. Ahmed Hassan',
    delivery_mode: 'ilt',
    capacity: 25,
    enrolled_count: 22,
    waitlist_count: 3,
    status: 'confirmed',
    data_source: 'offline',
  },
  {
    id: '2',
    title: 'Cybersecurity Fundamentals - Jan 2025',
    course_name: 'Cybersecurity Fundamentals',
    course_code: 'CYBER-201',
    start_date: '2025-01-16',
    end_date: '2025-01-16',
    start_time: '10:00',
    end_time: '14:00',
    venue: 'Virtual',
    room: 'Zoom',
    instructor: 'Eng. Sara Mohamed',
    delivery_mode: 'vilt',
    capacity: 40,
    enrolled_count: 38,
    waitlist_count: 5,
    status: 'open',
    data_source: 'lms',
  },
  {
    id: '3',
    title: 'Data Analysis Workshop',
    course_name: 'Advanced Data Analysis',
    course_code: 'DATA-301',
    start_date: '2025-01-20',
    end_date: '2025-01-22',
    start_time: '09:00',
    end_time: '16:00',
    venue: 'Tech Hub',
    room: 'Computer Lab 2',
    instructor: 'Mohamed Ali',
    delivery_mode: 'blended',
    capacity: 20,
    enrolled_count: 15,
    waitlist_count: 0,
    status: 'scheduled',
    data_source: 'offline',
  },
  {
    id: '4',
    title: 'Project Management Essentials - Q1',
    course_name: 'Project Management Essentials',
    course_code: 'PM-101',
    start_date: '2025-01-10',
    end_date: '2025-01-12',
    start_time: '09:00',
    end_time: '17:00',
    venue: 'Main Training Center',
    room: 'Room 205',
    instructor: 'Khalid Al-Rashid',
    delivery_mode: 'ilt',
    capacity: 30,
    enrolled_count: 30,
    waitlist_count: 8,
    status: 'in_progress',
    data_source: 'lms',
  },
  {
    id: '5',
    title: 'Business Communication Skills',
    course_name: 'Business Communication Skills',
    course_code: 'COMM-102',
    start_date: '2025-01-08',
    end_date: '2025-01-08',
    start_time: '13:00',
    end_time: '17:00',
    venue: 'Branch Office - Jeddah',
    room: 'Training Room',
    instructor: 'Fatima Al-Zahrani',
    delivery_mode: 'ilt',
    capacity: 25,
    enrolled_count: 24,
    waitlist_count: 0,
    status: 'completed',
    data_source: 'offline',
  },
  {
    id: '6',
    title: 'Digital Marketing Bootcamp',
    course_name: 'Digital Marketing Masterclass',
    course_code: 'DIGI-401',
    start_date: '2025-01-25',
    end_date: '2025-01-27',
    start_time: '10:00',
    end_time: '15:00',
    venue: 'Virtual',
    room: 'MS Teams',
    instructor: 'Noura Ibrahim',
    delivery_mode: 'vilt',
    capacity: 35,
    enrolled_count: 12,
    waitlist_count: 0,
    status: 'draft',
    data_source: 'lms',
  },
  {
    id: '7',
    title: 'AI for Business Leaders',
    course_name: 'Generative AI for Business',
    course_code: 'AI-501',
    start_date: '2025-02-01',
    end_date: '2025-02-02',
    start_time: '09:00',
    end_time: '16:00',
    venue: 'Innovation Center',
    room: 'Executive Suite',
    instructor: 'Dr. Omar Khaled',
    delivery_mode: 'blended',
    capacity: 30,
    enrolled_count: 28,
    waitlist_count: 4,
    status: 'confirmed',
    data_source: 'offline',
  },
  {
    id: '8',
    title: 'HR Strategy Workshop',
    course_name: 'Strategic HR Management',
    course_code: 'HR-201',
    start_date: '2025-01-05',
    end_date: '2025-01-06',
    start_time: '09:00',
    end_time: '17:00',
    venue: 'Main Training Center',
    room: 'Hall B',
    instructor: 'Salma Ahmed',
    delivery_mode: 'ilt',
    capacity: 25,
    enrolled_count: 20,
    waitlist_count: 0,
    status: 'cancelled',
    data_source: 'offline',
  },
];

const statusConfig = {
  draft: { label: 'Draft', color: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300', icon: Edit },
  scheduled: { label: 'Scheduled', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: Calendar },
  open: { label: 'Open', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: CheckCircle },
  confirmed: { label: 'Confirmed', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle },
  in_progress: { label: 'In Progress', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: Clock },
  completed: { label: 'Completed', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400', icon: XCircle },
};

export default function SessionsPage() {
  const [sessions] = useState<Session[]>(sampleSessions);

  const columns: Column<Session>[] = [
    {
      key: 'title',
      header: 'Session',
      sortable: true,
      render: (session) => (
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center',
            session.delivery_mode === 'vilt' 
              ? 'bg-purple-100 dark:bg-purple-900/30' 
              : 'bg-entlaqa-100 dark:bg-entlaqa-900/30'
          )}>
            {session.delivery_mode === 'vilt' ? (
              <Video className="w-5 h-5 text-purple-600" />
            ) : (
              <Calendar className="w-5 h-5 text-entlaqa-600" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-900 dark:text-white max-w-[200px] truncate">
                {session.title}
              </span>
              <SourceDot source={session.data_source} size="sm" />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {session.course_code} • {session.course_name}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'start_date',
      header: 'Date & Time',
      sortable: true,
      render: (session) => (
        <div>
          <p className="font-medium text-slate-900 dark:text-white">
            {formatDate(session.start_date)}
            {session.start_date !== session.end_date && (
              <span className="text-slate-400"> - {formatDate(session.end_date)}</span>
            )}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {formatTime(session.start_time)} - {formatTime(session.end_time)}
          </p>
        </div>
      ),
    },
    {
      key: 'venue',
      header: 'Location',
      render: (session) => (
        <div className="flex items-start gap-1.5">
          <MapPin className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-slate-700 dark:text-slate-300">{session.venue}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{session.room}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'instructor',
      header: 'Instructor',
      render: (session) => (
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-medium text-slate-600 dark:text-slate-300">
            {session.instructor.split(' ').map(n => n[0]).join('')}
          </div>
          <span className="text-slate-700 dark:text-slate-300 text-sm">{session.instructor}</span>
        </div>
      ),
    },
    {
      key: 'enrolled_count',
      header: 'Enrollment',
      sortable: true,
      render: (session) => {
        const percentage = (session.enrolled_count / session.capacity) * 100;
        const isFull = percentage >= 100;
        
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={cn(
                'font-medium',
                isFull ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'
              )}>
                {session.enrolled_count}/{session.capacity}
              </span>
              {session.waitlist_count > 0 && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  +{session.waitlist_count} waitlist
                </span>
              )}
            </div>
            <div className="w-20 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div 
                className={cn(
                  'h-full rounded-full',
                  isFull ? 'bg-emerald-500' : 'bg-entlaqa-500'
                )}
                style={{ width: `${Math.min(percentage, 100)}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (session) => {
        const config = statusConfig[session.status];
        const Icon = config.icon;
        
        return (
          <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium', config.color)}>
            <Icon className="w-3 h-3" />
            {config.label}
          </span>
        );
      },
    },
  ];

  const actions = [
    {
      label: 'View Details',
      icon: <Eye className="w-4 h-4" />,
      onClick: (session: Session) => console.log('View', session),
    },
    {
      label: 'Edit Session',
      icon: <Edit className="w-4 h-4" />,
      onClick: (session: Session) => console.log('Edit', session),
    },
    {
      label: 'Duplicate',
      icon: <Copy className="w-4 h-4" />,
      onClick: (session: Session) => console.log('Duplicate', session),
    },
    {
      label: 'Cancel',
      icon: <XCircle className="w-4 h-4" />,
      onClick: (session: Session) => console.log('Cancel', session),
      variant: 'danger' as const,
    },
  ];

  // Stats
  const stats = {
    total: sessions.length,
    upcoming: sessions.filter(s => ['scheduled', 'open', 'confirmed'].includes(s.status)).length,
    inProgress: sessions.filter(s => s.status === 'in_progress').length,
    completed: sessions.filter(s => s.status === 'completed').length,
    offline: sessions.filter(s => s.data_source === 'offline').length,
    lms: sessions.filter(s => s.data_source === 'lms').length,
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <Header
        title="Training Sessions"
        subtitle="Schedule and manage training sessions"
      />

      <div className="p-6 space-y-6">
        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
          >
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</p>
            <p className="text-sm text-slate-500">Total Sessions</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
          >
            <p className="text-2xl font-bold text-blue-600">{stats.upcoming}</p>
            <p className="text-sm text-slate-500">Upcoming</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
          >
            <p className="text-2xl font-bold text-amber-600">{stats.inProgress}</p>
            <p className="text-sm text-slate-500">In Progress</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
          >
            <p className="text-2xl font-bold text-emerald-600">{stats.completed}</p>
            <p className="text-sm text-slate-500">Completed</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
          >
            <div className="flex items-center gap-2">
              <SourceDot source="offline" />
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.offline}</p>
            </div>
            <p className="text-sm text-slate-500">Offline</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
          >
            <div className="flex items-center gap-2">
              <SourceDot source="lms" />
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.lms}</p>
            </div>
            <p className="text-sm text-slate-500">LMS</p>
          </motion.div>
        </div>

        {/* Data Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <DataTable
            data={sessions}
            columns={columns}
            searchable
            searchPlaceholder="Search sessions..."
            searchKeys={['title', 'course_name', 'course_code', 'instructor', 'venue']}
            showSourceFilter
            getSourceFn={(session) => session.data_source}
            actions={actions}
            headerActions={
              <div className="flex items-center gap-2">
                <button className="btn-ghost text-sm">
                  <Download className="w-4 h-4" />
                  Export
                </button>
                <button className="btn-primary text-sm">
                  <Plus className="w-4 h-4" />
                  New Session
                </button>
              </div>
            }
            emptyState={{
              title: 'No sessions found',
              description: 'Create your first training session to get started.',
              action: {
                label: 'Create Session',
                onClick: () => console.log('Create session'),
              },
            }}
          />
        </motion.div>
      </div>
    </div>
  );
}
